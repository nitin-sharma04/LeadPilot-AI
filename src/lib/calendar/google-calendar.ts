/**
 * Google Calendar provider abstraction — server-side only.
 * Never import from client components.
 */

import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { getGoogleOAuthConfig } from "./google-config";
import { addMinutes, formatRfc3339Local, rangesOverlap } from "./timezone";

export type BusyPeriod = { start: Date; end: Date };

export type CalendarEventInput = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  timezone: string;
  attendeeEmail?: string;
};

export type CalendarEventResult = {
  externalEventId: string;
  meetingUrl?: string | null;
  htmlLink?: string | null;
};

function oauthClient() {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function exchangeGoogleCode(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new AppError(
      "Google did not return refresh credentials. Reconnect and grant offline access.",
      400
    );
  }
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const me = await oauth2.userinfo.get();
  const email = me.data.email;
  if (!email) {
    throw new AppError("Unable to read Google account email.", 400);
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: new Date(tokens.expiry_date || Date.now() + 3600_000),
    scope: tokens.scope || "",
    googleEmail: email,
  };
}

async function getAuthedClientForUser(userId: string, companyId: string) {
  const conn = await prisma.googleCalendarConnection.findFirst({
    where: { userId, companyId },
  });
  if (!conn) {
    throw new AppError("Google Calendar is not connected.", 400);
  }

  const isDemo =
    conn.scope === "demo" ||
    conn.accessToken.startsWith("demo-") ||
    getGoogleOAuthConfig().demo;

  if (isDemo) {
    return { client: null as ReturnType<typeof oauthClient> | null, conn, isDemo: true as const };
  }

  const client = oauthClient();
  client.setCredentials({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken,
    expiry_date: conn.expiryDate.getTime(),
  });

  client.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await prisma.googleCalendarConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: tokens.access_token,
        expiryDate: new Date(tokens.expiry_date || Date.now() + 3600_000),
        ...(tokens.refresh_token
          ? { refreshToken: tokens.refresh_token }
          : {}),
      },
    });
  });

  return { client, conn, isDemo: false as const };
}

export async function getCalendarAvailability(input: {
  userId: string;
  companyId: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<BusyPeriod[]> {
  const { client, conn, isDemo } = await getAuthedClientForUser(
    input.userId,
    input.companyId
  );
  if (isDemo || !client) {
    // Demo: no external busy periods (LeadPilot local conflicts still apply).
    return [];
  }
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: input.timeMin.toISOString(),
        timeMax: input.timeMax.toISOString(),
        items: [{ id: conn.calendarId || "primary" }],
      },
    });
    const busy = res.data.calendars?.[conn.calendarId || "primary"]?.busy || [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b) => ({
        start: new Date(b.start as string),
        end: new Date(b.end as string),
      }));
  } catch {
    throw new AppError(
      "Unable to read Google Calendar availability. Try reconnecting.",
      502
    );
  }
}

export async function createCalendarEvent(input: {
  userId: string;
  companyId: string;
  event: CalendarEventInput;
}): Promise<CalendarEventResult> {
  const { client, conn, isDemo } = await getAuthedClientForUser(
    input.userId,
    input.companyId
  );

  if (isDemo || !client) {
    const id = `demo-event-${Date.now()}`;
    return {
      externalEventId: id,
      meetingUrl: `https://meet.google.com/demo-${id.slice(-8)}`,
      htmlLink: `https://calendar.google.com/calendar/demo/${id}`,
    };
  }

  const calendar = google.calendar({ version: "v3", auth: client });

  const startLocal = formatRfc3339Local(input.event.start, input.event.timezone);
  const endLocal = formatRfc3339Local(input.event.end, input.event.timezone);

  console.info("[calendar:google] create event", {
    timezone: input.event.timezone,
    utcStartIso: input.event.start.toISOString(),
    utcEndIso: input.event.end.toISOString(),
    googleStartDateTime: startLocal,
    googleStartTimeZone: input.event.timezone,
    googleEndDateTime: endLocal,
    googleEndTimeZone: input.event.timezone,
  });

  try {
    const res = await calendar.events.insert({
      calendarId: conn.calendarId || "primary",
      conferenceDataVersion: 1,
      requestBody: {
        summary: input.event.title,
        description: input.event.description,
        start: {
          // Local wall clock + IANA timeZone (no trailing Z).
          dateTime: startLocal,
          timeZone: input.event.timezone,
        },
        end: {
          dateTime: endLocal,
          timeZone: input.event.timezone,
        },
        attendees: input.event.attendeeEmail
          ? [{ email: input.event.attendeeEmail }]
          : undefined,
        conferenceData: {
          createRequest: {
            requestId: `lp-${Date.now()}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });

    const eventId = res.data.id;
    if (!eventId) {
      throw new AppError("Google Calendar did not return an event id.", 502);
    }

    const meet =
      res.data.hangoutLink ||
      res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
        ?.uri ||
      null;

    return {
      externalEventId: eventId,
      meetingUrl: meet,
      htmlLink: res.data.htmlLink,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "Unable to create Google Calendar event. Try reconnecting.",
      502
    );
  }
}

export async function updateCalendarEvent(input: {
  userId: string;
  companyId: string;
  externalEventId: string;
  event: CalendarEventInput;
}): Promise<CalendarEventResult> {
  const { client, conn, isDemo } = await getAuthedClientForUser(
    input.userId,
    input.companyId
  );
  if (isDemo || !client) {
    return {
      externalEventId: input.externalEventId,
      meetingUrl: `https://meet.google.com/demo-updated`,
      htmlLink: `https://calendar.google.com/calendar/demo/${input.externalEventId}`,
    };
  }
  const calendar = google.calendar({ version: "v3", auth: client });

  const startLocal = formatRfc3339Local(input.event.start, input.event.timezone);
  const endLocal = formatRfc3339Local(input.event.end, input.event.timezone);

  try {
    const res = await calendar.events.patch({
      calendarId: conn.calendarId || "primary",
      eventId: input.externalEventId,
      requestBody: {
        summary: input.event.title,
        description: input.event.description,
        start: {
          dateTime: startLocal,
          timeZone: input.event.timezone,
        },
        end: {
          dateTime: endLocal,
          timeZone: input.event.timezone,
        },
      },
    });
    return {
      externalEventId: res.data.id || input.externalEventId,
      meetingUrl: res.data.hangoutLink,
      htmlLink: res.data.htmlLink,
    };
  } catch {
    throw new AppError("Unable to update Google Calendar event.", 502);
  }
}

export async function deleteCalendarEvent(input: {
  userId: string;
  companyId: string;
  externalEventId: string;
}): Promise<void> {
  const { client, conn, isDemo } = await getAuthedClientForUser(
    input.userId,
    input.companyId
  );
  if (isDemo || !client) return;
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({
      calendarId: conn.calendarId || "primary",
      eventId: input.externalEventId,
    });
  } catch {
    // Event may already be deleted — ignore soft failures
  }
}

export function hasBusyConflict(
  start: Date,
  end: Date,
  busy: BusyPeriod[]
): boolean {
  return busy.some((b) => rangesOverlap(start, end, b.start, b.end));
}

export function defaultWorkingWindow(day: Date): { start: Date; end: Date } {
  const start = new Date(day);
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(day);
  end.setUTCHours(17, 0, 0, 0);
  return { start, end };
}

export { addMinutes };
