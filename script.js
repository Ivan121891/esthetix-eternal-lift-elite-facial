(function () {
  "use strict";

  // ------- Configuration -------
  const SERVICE_NAME = "Royal V-Line Rejuvenation";
  const SERVICE_DURATION_MIN = 60;

  // GHL credentials
  const GHL = {
    locationId: 'PERgnPUf5rORAamkuPWc',
    calendarId: '3KR0o3XtDlPI045BglRH',
    userId:     '2tQreqXcDpaAiSBqlK7T',
    apiKey:     'pit-653f9578-ecb4-415c-ad7c-5738748b0fc7',
    apiBase:    'https://services.leadconnectorhq.com',
    version:    '2021-07-28',
  };

  const BUSINESS_TZ = "America/Los_Angeles";

  // Generate 1-hr slots from 9 AM to 5 PM
  function buildAllSlots() {
    const slots = [];
    for (let h = 9; h <= 17; h++) {
      const ampm = h < 12 ? 'AM' : 'PM';
      const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
      slots.push({ label: display + ':00 ' + ampm, hour: h, minute: 0 });
    }
    return slots;
  }
  let ALL_SLOTS = buildAllSlots();

  const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const STEPS = ["date", "time", "details", "confirmed"];

  // ------- State -------
  const today = startOfDay(new Date());
  let selectedDate = null;
  let selectedTime = null;

  // ------- Elements -------
  const $ = (id) => document.getElementById(id);
  const dateGrid = $("date-grid");
  const morningGrid = $("morning-grid");
  const afternoonGrid = $("afternoon-grid");

  const timeSummary    = $("time-summary");
  const detailsSummary = $("details-summary");
  const detailsForm    = $("details-form");
  const submitBtn      = $("submit-btn");
  const btnLabel       = submitBtn.querySelector(".btn-label");
  const spinner        = submitBtn.querySelector(".spinner");
  const errorText      = $("error-text");
  const resetBtn       = $("reset-btn");
  const gcalLink       = $("gcal-link");
  const confirmCard    = $("confirm-card");

  // ------- Helpers -------
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function offsetMinutesForTz(date, tz) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23",
    });
    const parts = dtf.formatToParts(date);
    const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
    const asUtc = Date.UTC(
      get("year"), get("month") - 1, get("day"),
      get("hour"), get("minute"), get("second"),
    );
    return Math.round((asUtc - date.getTime()) / 60000);
  }

  function dateFromWallTime(year, month, day, hour, minute, tz) {
    const approx = new Date(Date.UTC(year, month, day, hour, minute));
    const off = offsetMinutesForTz(approx, tz);
    return new Date(approx.getTime() - off * 60000);
  }

  function isoInTz(date, tz) {
    const off = offsetMinutesForTz(date, tz);
    const wall = new Date(date.getTime() + off * 60000);
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
           `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
           `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }
  function sameDay(a, b) {
    return a && b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function formatLongDate(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
  }

  // ------- Step navigation -------
  function showStep(step) {
    STEPS.forEach((s) => {
      const el = $("step-" + s);
      if (el) el.classList.toggle("hidden", s !== step);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------- Calendar render -------
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW_ABBR = ["S","M","T","W","T","F","S"];

  function renderMonth() {
    dateGrid.innerHTML = "";

    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Month header
    const header = document.createElement("div");
    header.className = "month-header";
    header.textContent = MONTHS[month] + " " + year;
    dateGrid.appendChild(header);

    // Day-of-week header row
    const dowRow = document.createElement("div");
    dowRow.className = "dow-row";
    DOW_ABBR.forEach((d) => {
      const cell = document.createElement("span");
      cell.className = "dow-label";
      cell.textContent = d;
      dowRow.appendChild(cell);
    });
    dateGrid.appendChild(dowRow);

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement("div");
      empty.className = "date-cell empty";
      dateGrid.appendChild(empty);
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "date-cell";
      const daySpan = document.createElement("span");
      daySpan.className = "day";
      daySpan.textContent = String(d);
      btn.appendChild(daySpan);

      if (sameDay(date, selectedDate)) btn.classList.add("selected");
      if (date < today) btn.classList.add("disabled");

      btn.addEventListener("click", () => selectDate(date));
      dateGrid.appendChild(btn);
    }
  }

  function renderTimes() {
    const now = new Date();
    const isToday = selectedDate && sameDay(selectedDate, today);

    function filterPast(slots) {
      if (!isToday) return slots;
      return slots.filter(s => {
        const slotTime = dateFromWallTime(
          selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
          s.hour, s.minute, BUSINESS_TZ
        );
        return slotTime.getTime() > now.getTime();
      });
    }

    // Morning block (9 AM - 11 AM)
    const morning = ALL_SLOTS.filter(s => s.hour >= 9 && s.hour <= 11);
    const morningAvail = filterPast(morning);
    morningGrid.innerHTML = "";
    if (morningAvail.length > 0) {
      morningAvail.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "time-cell";
        if (selectedTime && selectedTime.label === s.label) b.classList.add("selected");
        b.textContent = s.label;
        b.addEventListener("click", () => selectTime(s));
        morningGrid.appendChild(b);
      });
    } else {
      morningGrid.innerHTML = '<p style="font-size:.8rem;color:var(--muted-foreground);text-align:center;grid-column:1/-1;padding:6px 0;">No available morning slots</p>';
    }

    // Afternoon block (12 PM - 5 PM)
    const afternoon = ALL_SLOTS.filter(s => s.hour >= 12 && s.hour <= 17);
    const afternoonAvail = filterPast(afternoon);
    afternoonGrid.innerHTML = "";
    if (afternoonAvail.length > 0) {
      afternoonAvail.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "time-cell";
        if (selectedTime && selectedTime.label === s.label) b.classList.add("selected");
        b.textContent = s.label;
        b.addEventListener("click", () => selectTime(s));
        afternoonGrid.appendChild(b);
      });
    } else {
      afternoonGrid.innerHTML = '<p style="font-size:.8rem;color:var(--muted-foreground);text-align:center;grid-column:1/-1;padding:6px 0;">No available afternoon slots</p>';
    }
  }

  // ------- Selection handlers -------
  function selectDate(d) {
    selectedDate = startOfDay(d);
    selectedTime = null;
    renderMonth();
    renderTimes();
    timeSummary.textContent = formatLongDate(selectedDate);
    showStep("time");
    track("AddToCart", { content_name: SERVICE_NAME });
  }

  function selectTime(slot) {
    selectedTime = slot;
    renderTimes();
    detailsSummary.textContent =
      `${formatLongDate(selectedDate)} • ${selectedTime.label}`;
    showStep("details");
    track("InitiateCheckout", { content_name: SERVICE_NAME });
  }

  function track(event, params) {
    if (typeof window.fbq === "function") {
      try { window.fbq("track", event, params || {}); } catch (_) {}
    }
  }

  // ------- Back buttons -------
  document.querySelectorAll(".back-btn").forEach((btn) => {
    btn.addEventListener("click", () => showStep(btn.dataset.back));
  });

  // ------- GHL API call -------
  async function ghlFetch(path, body) {
    const res = await fetch(GHL.apiBase + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GHL.apiKey,
        'Version': GHL.version,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
    return data;
  }

  // ------- Form submit -------
  detailsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorText.classList.add("hidden");

    const name  = $("name").value.trim();
    const email = $("email").value.trim();
    const phone = $("phone").value.trim();

    if (!name || !email || !phone || !selectedDate || !selectedTime) {
      errorText.textContent = "Please fill in all fields.";
      errorText.classList.remove("hidden");
      return;
    }

    submitBtn.disabled = true;
    btnLabel.textContent = "Booking";
    spinner.classList.remove("hidden");

    const start = dateFromWallTime(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      selectedTime.hour, selectedTime.minute, BUSINESS_TZ,
    );
    const end = new Date(start.getTime() + SERVICE_DURATION_MIN * 60000);
    const [firstName, ...rest] = name.split(/\s+/);
    const lastName = rest.join(" ");

    try {
      // 1) Upsert contact in GHL
      const contactRes = await ghlFetch('/contacts/upsert', {
        locationId: GHL.locationId,
        firstName: firstName || name,
        lastName: lastName || '-',
        email,
        phone,
        source: 'Royal V-Line LP',
        tags: ['Royal V-Line Rejuvenation'],
      });
      const contactId = contactRes.contact?.id || contactRes.id;

      // 2) Book appointment
      // appointmentStatus: 'confirmed' ensures the booking is visible in
      // the GHL dashboard calendar view (default 'new' may be hidden).
      // selectedTimezone tells GHL which timezone the slot was picked in.
      await ghlFetch('/calendars/events/appointments', {
        calendarId: GHL.calendarId,
        locationId: GHL.locationId,
        contactId,
        assignedUserId: GHL.userId,
        startTime:      isoInTz(start, BUSINESS_TZ),
        endTime:        isoInTz(end,   BUSINESS_TZ),
        title:          `${name} — Royal V-Line Rejuvenation`,
        appointmentStatus: 'confirmed',
        selectedTimezone: BUSINESS_TZ,
      });

      track("Lead", { content_name: SERVICE_NAME });
      track("Schedule", { content_name: SERVICE_NAME });

      renderConfirmation({
        service: SERVICE_NAME,
        name, email, phone,
        time: selectedTime.label,
      });
      showStep("confirmed");
    } catch (err) {
      console.error("GHL booking error", err);
      const detail = (err && err.message) ? err.message : "Booking failed. Please try again or call us.";
      errorText.textContent = detail;
      errorText.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
      btnLabel.textContent = "Schedule Appointment";
      spinner.classList.add("hidden");
    }
  });

  // ------- Confirmation rendering -------
  function renderConfirmation(p) {
    confirmCard.innerHTML = `
      <div class="row"><span class="label">Service</span><span>${escapeHtml(p.service)}</span></div>
      <div class="row"><span class="label">Date</span><span>${escapeHtml(formatLongDate(selectedDate))}</span></div>
      <div class="row"><span class="label">Time</span><span>${escapeHtml(p.time)}</span></div>
      <div class="row"><span class="label">Name</span><span>${escapeHtml(p.name)}</span></div>
      <div class="row"><span class="label">Email</span><span>${escapeHtml(p.email)}</span></div>
      <div class="row"><span class="label">Phone</span><span>${escapeHtml(p.phone)}</span></div>
    `;
    gcalLink.href = buildGCalUrl(p);
  }

  function buildGCalUrl(p) {
    const start = dateFromWallTime(
      selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(),
      selectedTime.hour, selectedTime.minute, BUSINESS_TZ,
    );
    const end = new Date(start.getTime() + SERVICE_DURATION_MIN * 60000);
    const fmt = (d) =>
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) + "Z";
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: SERVICE_NAME,
      dates: `${fmt(start)}/${fmt(end)}`,
      details: `Booking for ${p.name} (${p.email}, ${p.phone}).`,
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ------- Reset -------
  resetBtn.addEventListener("click", () => {
    selectedDate = null;
    selectedTime = null;
    detailsForm.reset();
    renderMonth();
    showStep("date");
  });

  // ------- Init -------
  renderMonth();
  renderTimes();
  showStep("date");
})();