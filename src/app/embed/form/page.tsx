"use client";

import { FormEvent, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function EmbedFormInner() {
  const params = useSearchParams();
  const formKey = params.get("key") || "";
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "err">(
    "idle"
  );
  const [error, setError] = useState("");

  const title = useMemo(
    () => params.get("title") || "Get in touch",
    [params]
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formKey) {
      setError("Missing form key");
      setStatus("err");
      return;
    }
    setStatus("sending");
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/public/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${formKey}`,
        },
        body: JSON.stringify({
          name: String(fd.get("name") || "").trim(),
          email: String(fd.get("email") || "").trim(),
          phone: String(fd.get("phone") || "").trim() || undefined,
          company: String(fd.get("company") || "").trim() || undefined,
          message: String(fd.get("message") || "").trim() || undefined,
          source: "WEB_FORM",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Submission failed");
      setStatus("ok");
    } catch (err) {
      setStatus("err");
      setError(err instanceof Error ? err.message : "Unable to submit");
    }
  }

  return (
    <main className="embed-shell">
      <div className="embed-card">
        {status === "ok" ? (
          <p className="success">
            Thanks! We received your request and will be in touch shortly.
          </p>
        ) : (
          <>
            <h1>{title}</h1>
            <p className="sub">
              Share a few details and our team will follow up shortly.
            </p>
            <form onSubmit={onSubmit}>
              <label>
                Name
                <input name="name" required minLength={2} />
              </label>
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Phone
                <input name="phone" type="tel" />
              </label>
              <label>
                Company
                <input name="company" />
              </label>
              <label>
                Message
                <textarea name="message" rows={4} />
              </label>
              {status === "err" ? <p className="err">{error}</p> : null}
              <button type="submit" disabled={status === "sending"}>
                {status === "sending" ? "Sending…" : "Submit"}
              </button>
            </form>
          </>
        )}
      </div>
      <style jsx>{`
        .embed-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: linear-gradient(
            160deg,
            #f4f7fb 0%,
            #e8eef6 45%,
            #dde6f2 100%
          );
          font-family: Georgia, "Times New Roman", serif;
        }
        .embed-card {
          width: min(440px, 100%);
          padding: 28px;
          border-radius: 14px;
          border: 1px solid #d2dae6;
          background: rgba(255, 255, 255, 0.72);
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
        }
        h1 {
          margin: 0 0 6px;
          font-size: 1.6rem;
          color: #0f172a;
        }
        .sub {
          margin: 0 0 18px;
          color: #5b6578;
          font-family: system-ui, sans-serif;
          font-size: 0.875rem;
        }
        label {
          display: block;
          margin-bottom: 12px;
          font-size: 0.82rem;
          color: #1a1f2e;
        }
        input,
        textarea {
          display: block;
          width: 100%;
          margin-top: 6px;
          padding: 10px 12px;
          border: 1px solid #c9d0dc;
          border-radius: 8px;
          font: 14px system-ui, sans-serif;
          background: #fbfcfe;
          box-sizing: border-box;
        }
        button {
          width: 100%;
          margin-top: 8px;
          padding: 12px;
          border: 0;
          border-radius: 8px;
          background: #0f172a;
          color: #fff;
          font: 600 14px system-ui, sans-serif;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.7;
          cursor: wait;
        }
        .err {
          color: #b42318;
          font: 13px system-ui, sans-serif;
        }
        .success {
          margin: 0;
          font-size: 1.1rem;
          line-height: 1.5;
          color: #0f172a;
        }
      `}</style>
    </main>
  );
}

export default function EmbedFormPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Loading…</main>}>
      <EmbedFormInner />
    </Suspense>
  );
}
