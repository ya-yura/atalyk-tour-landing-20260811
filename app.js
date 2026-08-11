const AVAILABILITY_URL = "content/availability.json";
const FORM_ENDPOINT = "";

const analytics = (name, params = {}) => {
  window.dispatchEvent(new CustomEvent(`atalyk:${name}`, { detail: params }));
  if (window.__ATALYK_ANALYTICS__ && typeof window.__ATALYK_ANALYTICS__[name] === "function") {
    window.__ATALYK_ANALYTICS__[name](params);
  }
};

const params = new URLSearchParams(window.location.search);
const utm = { utm_source: params.get("utm_source") || "", utm_campaign: params.get("utm_campaign") || "" };
const IS_DEV_MODE = params.get("mode") === "demo";
if (IS_DEV_MODE) document.body.classList.add("dev-mode");
document.querySelector("#utm-source").value = utm.utm_source;
document.querySelector("#utm-campaign").value = utm.utm_campaign;

const classGrid = document.querySelector("#class-grid");
const classSelect = document.querySelector("#class-select");
const form = document.querySelector("#tour-form-element");
const result = document.querySelector("#form-result");

const statusLabel = (entry) => {
  if (entry.status === "open") return entry.label || "Набор открыт";
  if (entry.status === "closed") return entry.label || "Набор закрыт";
  if (entry.status === "available") return `${entry.places} ${entry.places === 1 ? "место" : "места"}`;
  return "Данные уточняются";
};

const detailLabel = (entry) => {
  if (entry.status === "closed") return "Для этого класса сейчас нельзя отправить запрос на экскурсию через выбор места.";
  if (entry.status === "open") return "Можно уточнить доступность и следующий шаг на экскурсии.";
  if (entry.status === "available") return "Статус указан по данным школы на 1 сентября 2026.";
  return "Школа уточняет актуальное наличие перед публикацией.";
};

const selectClass = (classId, card) => {
  document.querySelectorAll(".class-card").forEach((item) => item.classList.remove("is-selected"));
  card.classList.add("is-selected");
  classSelect.value = classId;
  classSelect.dispatchEvent(new Event("change", { bubbles: true }));
  analytics("class_selected", { class: classId, ...utm });
  document.querySelector("#tour-form").scrollIntoView({ behavior: "smooth", block: "start" });
};

const renderAvailability = (data) => {
  classGrid.innerHTML = "";
  data.classes.forEach((entry) => {
    const isClosed = entry.status === "closed";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `class-card${isClosed ? " is-closed" : ""}`;
    card.dataset.class = entry.class;
    card.disabled = isClosed;
    card.setAttribute("aria-label", `Класс ${entry.class}: ${statusLabel(entry)}`);
    card.innerHTML = `<span class="class-card-top"><span class="class-label">Класс</span><span class="class-number">${entry.class}</span></span><span class="class-status">${statusLabel(entry)}</span><span class="class-detail">${detailLabel(entry)}</span>`;
    if (!isClosed) card.addEventListener("click", () => selectClass(entry.class, card));
    classGrid.append(card);
    const option = document.createElement("option");
    option.value = entry.class;
    option.textContent = `Класс ${entry.class} — ${statusLabel(entry)}`;
    option.disabled = isClosed;
    classSelect.append(option);
  });
  analytics("availability_viewed", { class: "all", ...utm });
};

const showLoadError = () => {
  classGrid.innerHTML = "<p class=\"loading-state\">Не удалось загрузить статусы. Обновите страницу или уточните наличие у школы.</p>";
};

fetch(AVAILABILITY_URL)
  .then((response) => { if (!response.ok) throw new Error("availability unavailable"); return response.json(); })
  .then(renderAvailability)
  .catch(showLoadError);

const fields = {
  class: { input: classSelect, error: document.querySelector("#class-error"), valid: (value) => Boolean(value) },
  parentName: { input: document.querySelector("#parent-name"), error: document.querySelector("#parent-name-error"), valid: (value) => value.trim().length > 1 },
  phone: { input: document.querySelector("#phone"), error: document.querySelector("#phone-error"), valid: (value) => value.replace(/\D/g, "").length >= 10 },
  consent: { input: document.querySelector("#consent"), error: document.querySelector("#consent-error"), valid: (value) => value === true },
};

Object.values(fields).forEach(({ input }) => input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); }));
document.querySelector("#class-select").addEventListener("change", () => analytics("class_selected", { class: classSelect.value, ...utm }));
form.addEventListener("focusin", () => { if (!form.dataset.started) { form.dataset.started = "true"; analytics("tour_form_started", { class: classSelect.value || "", ...utm }); } });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  let isValid = true;
  Object.entries(fields).forEach(([key, field]) => {
    const value = key === "consent" ? field.input.checked : field.input.value;
    const valid = field.valid(value);
    field.error.hidden = valid;
    if (!valid) { field.input.setAttribute("aria-invalid", "true"); isValid = false; }
  });
  if (!isValid) { analytics("tour_form_error", { class: classSelect.value || "", ...utm }); return; }

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.consent = true;
  if (!FORM_ENDPOINT) {
    result.hidden = false;
    result.className = "form-result is-error";
    result.textContent = IS_DEV_MODE
      ? "Форма пока не подключена к каналу школы. Сохраните выбранный класс и передайте endpoint или согласованный канал — после этого заявки начнут отправляться."
      : "Не получилось отправить заявку. Попробуйте ещё раз позже или свяжитесь со школой согласованным способом.";
    analytics("tour_form_error", { class: payload.class, ...utm, reason: "endpoint_missing" });
    return;
  }
  try {
    const response = await fetch(FORM_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error("request failed");
    result.hidden = false;
    result.className = "form-result";
    result.textContent = "Заявка отправлена. Школа свяжется с вами для подтверждения времени экскурсии";
    form.reset();
    analytics("tour_form_submitted", { class: payload.class, ...utm });
  } catch {
    result.hidden = false;
    result.className = "form-result is-error";
    result.textContent = "Не получилось отправить заявку. Проверьте соединение или свяжитесь со школой другим согласованным способом.";
    analytics("tour_form_error", { class: payload.class, ...utm, reason: "request_failed" });
  }
});
