/**
 * Integration checks for voice appointment booking against local DB (when available).
 * Covers confirmation → book, failure status, idempotency.
 * Run: npx tsx scripts/verify-voice-appointment-integration.ts
 */
import { AppointmentSource, CallStatus, PrismaClient } from "@prisma/client";
import { attemptBookAppointmentFromCall } from "../src/services/voice-appointment-booking";
import { bookAppointment } from "../src/services/appointments";
import { zonedLocalToUtc } from "../src/lib/calendar/timezone";

const prisma = new PrismaClient();

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

async function main() {
  const company = await prisma.company.findFirst({
    include: { users: { take: 1 } },
  });
  if (!company?.users[0]) {
    console.log("SKIP: no company/user in DB");
    return;
  }
  const user = company.users[0];
  const lead = await prisma.lead.findFirst({
    where: { companyId: company.id },
  });
  if (!lead) {
    console.log("SKIP: no lead in DB");
    return;
  }

  // Far-future manual slot for regression only
  const start = zonedLocalToUtc({
    year: 2026,
    month: 12,
    day: 15,
    hour: 16,
    minute: 0,
    timezone: "Asia/Kolkata",
  });

  // I. Manual booking still works
  const manualKey = `verify-manual-${Date.now()}`;
  const manual = await bookAppointment({
    companyId: company.id,
    leadId: lead.id,
    userId: user.id,
    assignedToId: user.id,
    title: "Verify manual booking",
    startTime: start,
    durationMinutes: 30,
    timezone: "Asia/Kolkata",
    source: AppointmentSource.MANUAL,
    idempotencyKey: manualKey,
    syncCalendar: false,
  });
  assert(!!manual.appointment.id, "I: manual booked");
  await prisma.appointment.delete({ where: { id: manual.appointment.id } });

  // Voice call fixture
  const call = await prisma.call.create({
    data: {
      companyId: company.id,
      leadId: lead.id,
      agentId: user.id,
      status: CallStatus.COMPLETED,
      direction: "OUTBOUND",
      voiceMode: "realtime",
      startedAt: new Date(),
      endedAt: new Date(),
    },
  });

  await prisma.callTranscript.createMany({
    data: [
      {
        callId: call.id,
        speaker: "LEAD",
        message: "Thing we can set up like tomorrow.",
      },
      { callId: call.id, speaker: "LEAD", message: "At 4:00 p.m." },
      { callId: call.id, speaker: "LEAD", message: "IST" },
      { callId: call.id, speaker: "LEAD", message: "IST afternoon" },
      {
        callId: call.id,
        speaker: "AI",
        message: "Just to confirm, tomorrow at 4 PM IST works for you?",
      },
      { callId: call.id, speaker: "LEAD", message: "Yes." },
    ],
  });

  const preferred = "tomorrow at 4:00 p.m. IST";

  // D. Booking success (calendar sync optional — may be demo/disconnected)
  const first = await attemptBookAppointmentFromCall({
    callId: call.id,
    forceConfirmed: true,
    preferredTimeText: preferred,
  });
  assert(first.booked === true, `D: booked (${first.reason || "ok"})`);
  assert(first.appointmentStatus === "booked", "D: status booked");
  assert(!!first.appointmentId, "D: appointmentId");
  assert(first.timezone === "Asia/Kolkata", "D: timezone Kolkata");

  // G. Idempotency
  const second = await attemptBookAppointmentFromCall({
    callId: call.id,
    forceConfirmed: true,
    preferredTimeText: preferred,
  });
  assert(second.booked === true, "G: second finalize booked");
  assert(second.appointmentId === first.appointmentId, "G: same appointment");
  assert(second.reusedExisting === true, "G: reusedExisting");

  const count = await prisma.appointment.count({
    where: { idempotencyKey: `call:${call.id}` },
  });
  assert(count === 1, "G: exactly one appointment");

  // E. Booking failure path (conflict) — same tomorrow slot
  const call2 = await prisma.call.create({
    data: {
      companyId: company.id,
      leadId: lead.id,
      agentId: user.id,
      status: CallStatus.COMPLETED,
      direction: "OUTBOUND",
      voiceMode: "realtime",
      startedAt: new Date(),
      endedAt: new Date(),
    },
  });
  await prisma.callTranscript.createMany({
    data: [
      {
        callId: call2.id,
        speaker: "LEAD",
        message: "Tomorrow at 4:00 p.m. IST works",
      },
      { callId: call2.id, speaker: "LEAD", message: "Yes" },
    ],
  });
  // Slot already taken by first voice appointment — expect failure
  const failed = await attemptBookAppointmentFromCall({
    callId: call2.id,
    forceConfirmed: true,
    preferredTimeText: preferred,
  });
  assert(failed.booked === false, "E: not booked on conflict");
  assert(failed.appointmentStatus === "failed", "E: status failed");
  assert(failed.reason === "book_failed", "E: book_failed reason");

  // Cleanup
  await prisma.appointment.deleteMany({
    where: {
      OR: [
        { idempotencyKey: `call:${call.id}` },
        { title: "Verify manual booking" },
      ],
    },
  });
  await prisma.callTranscript.deleteMany({
    where: { callId: { in: [call.id, call2.id] } },
  });
  await prisma.call.deleteMany({ where: { id: { in: [call.id, call2.id] } } });

  console.log("Voice appointment integration verification passed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
