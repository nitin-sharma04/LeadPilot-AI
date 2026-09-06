/**
 * Lightweight embeddable LeadPilot form bootstrap.
 * Usage:
 *   <script src="https://your-app/embed/leadpilot.js"></script>
 *   <script>LeadPilot.init({ formKey: "lp_live_...", target: "#lp-form" })</script>
 */
(function (global) {
  "use strict";

  var API_PATH = "/api/public/leads";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "style" && typeof attrs[k] === "object") {
          Object.assign(node.style, attrs[k]);
        } else if (k === "className") {
          node.className = attrs[k];
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach(function (c) {
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else if (c) node.appendChild(c);
    });
    return node;
  }

  function field(label, name, type, required) {
    var wrap = el("label", {
      style: {
        display: "block",
        marginBottom: "12px",
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "13px",
        color: "#1a1f2e",
      },
    });
    wrap.appendChild(document.createTextNode(label));
    var input =
      type === "textarea"
        ? el("textarea", {
            name: name,
            required: required ? "required" : undefined,
            rows: "4",
            style: {
              display: "block",
              width: "100%",
              marginTop: "6px",
              padding: "10px 12px",
              border: "1px solid #c9d0dc",
              borderRadius: "6px",
              fontSize: "14px",
              fontFamily: "system-ui, sans-serif",
              boxSizing: "border-box",
              background: "#fbfcfe",
            },
          })
        : el("input", {
            type: type || "text",
            name: name,
            required: required ? "required" : undefined,
            style: {
              display: "block",
              width: "100%",
              marginTop: "6px",
              padding: "10px 12px",
              border: "1px solid #c9d0dc",
              borderRadius: "6px",
              fontSize: "14px",
              fontFamily: "system-ui, sans-serif",
              boxSizing: "border-box",
              background: "#fbfcfe",
            },
          });
    wrap.appendChild(input);
    return wrap;
  }

  function renderForm(container, opts) {
    var root = el("div", {
      style: {
        maxWidth: "420px",
        padding: "24px",
        borderRadius: "12px",
        background:
          "linear-gradient(165deg, #f7f9fc 0%, #eef2f8 55%, #e8edf5 100%)",
        border: "1px solid #d5dde8",
        boxShadow: "0 8px 24px rgba(26, 31, 46, 0.08)",
      },
    });

    root.appendChild(
      el(
        "h3",
        {
          style: {
            margin: "0 0 4px",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "22px",
            fontWeight: "600",
            color: "#0f172a",
          },
        },
        [opts.title || "Get in touch"]
      )
    );
    root.appendChild(
      el(
        "p",
        {
          style: {
            margin: "0 0 18px",
            fontSize: "13px",
            color: "#5b6578",
            fontFamily: "system-ui, sans-serif",
          },
        },
        [
          opts.subtitle ||
            "Share a few details and our team will follow up shortly.",
        ]
      )
    );

    var form = el("form", { novalidate: "novalidate" });
    form.appendChild(field("Name", "name", "text", true));
    form.appendChild(field("Email", "email", "email", true));
    form.appendChild(field("Phone", "phone", "tel", false));
    form.appendChild(field("Company", "company", "text", false));
    form.appendChild(field("Message", "message", "textarea", false));

    var status = el("p", {
      style: {
        display: "none",
        margin: "0 0 10px",
        fontSize: "13px",
        fontFamily: "system-ui, sans-serif",
      },
    });
    form.appendChild(status);

    var btn = el(
      "button",
      {
        type: "submit",
        style: {
          width: "100%",
          padding: "12px 16px",
          border: "none",
          borderRadius: "8px",
          background: "#0f172a",
          color: "#fff",
          fontSize: "14px",
          fontWeight: "600",
          cursor: "pointer",
          fontFamily: "system-ui, sans-serif",
        },
      },
      [opts.buttonText || "Submit"]
    );
    form.appendChild(btn);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.style.display = "none";
      btn.disabled = true;
      btn.textContent = "Sending…";

      var fd = new FormData(form);
      var payload = {
        name: String(fd.get("name") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        phone: String(fd.get("phone") || "").trim() || undefined,
        company: String(fd.get("company") || "").trim() || undefined,
        message: String(fd.get("message") || "").trim() || undefined,
        source: "WEB_FORM",
      };

      var base =
        opts.apiBase ||
        (document.currentScript && document.currentScript.src
          ? new URL(document.currentScript.src).origin
          : window.location.origin);

      fetch(base + API_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + opts.formKey,
        },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json().then(function (json) {
            if (!res.ok) throw new Error(json.error || "Submission failed");
            return json;
          });
        })
        .then(function () {
          form.style.display = "none";
          root.appendChild(
            el(
              "p",
              {
                style: {
                  margin: "8px 0 0",
                  fontSize: "15px",
                  lineHeight: "1.5",
                  color: "#0f172a",
                  fontFamily: "Georgia, 'Times New Roman', serif",
                },
              },
              [
                opts.successMessage ||
                  "Thanks! We received your request and will be in touch shortly.",
              ]
            )
          );
        })
        .catch(function (err) {
          status.style.display = "block";
          status.style.color = "#b42318";
          status.textContent =
            err && err.message ? err.message : "Unable to submit. Try again.";
          btn.disabled = false;
          btn.textContent = opts.buttonText || "Submit";
        });
    });

    root.appendChild(form);
    container.innerHTML = "";
    container.appendChild(root);
  }

  function init(options) {
    if (!options || !options.formKey) {
      console.error("[LeadPilot] formKey is required");
      return;
    }
    var target =
      typeof options.target === "string"
        ? document.querySelector(options.target)
        : options.target;
    if (!target) {
      console.error("[LeadPilot] target element not found");
      return;
    }
    renderForm(target, options);
  }

  global.LeadPilot = { init: init };
})(typeof window !== "undefined" ? window : this);
