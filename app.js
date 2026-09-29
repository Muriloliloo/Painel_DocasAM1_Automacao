const waves = [
  { name: "1ª onda", start: "08:30", end: "09:15", planned: 24, arrived: 0, loaded: 0 },
  { name: "2ª onda", start: "09:15", end: "10:00", planned: 24, arrived: 0, loaded: 0 },
  { name: "3ª onda", start: "10:00", end: "10:45", planned: 24, arrived: 0, loaded: 0 },
  { name: "4ª onda", start: "10:45", end: "11:30", planned: 24, arrived: 0, loaded: 0 },
  { name: "5ª onda", start: "11:30", end: "12:15", planned: 24, arrived: 0, loaded: 0 },
];

const totalRoutesInput = document.querySelector("#totalRoutes");
const targetPercentInput = document.querySelector("#targetPercent");
const managerNameInput = document.querySelector("#managerName");
const managerPhoneInput = document.querySelector("#managerPhone");
const wavesBody = document.querySelector("#wavesBody");
const managerMessage = document.querySelector("#managerMessage");
const copyFeedback = document.querySelector("#copyFeedback");
const whatsappLink = document.querySelector("#whatsappLink");
const syncStatus = document.querySelector("#syncStatus");
const autoDispatchButton = document.querySelector("#autoDispatchButton");
const autoDispatchStatus = document.querySelector("#autoDispatchStatus");
const autoDispatchField = document.querySelector(".auto-dispatch-field");
const dispatchLog = document.querySelector("#dispatchLog");
const accessRoleSelect = document.querySelector("#accessRole");
const accessCodeInput = document.querySelector("#accessCode");
const accessLoginButton = document.querySelector("#accessLoginButton");
const accessLogoutButton = document.querySelector("#accessLogoutButton");
const togglePasswordButton = document.querySelector("#togglePasswordButton");
const accessStatus = document.querySelector("#accessStatus");
const accessHint = document.querySelector("#accessHint");
const supabaseSettings = window.EXPEDITION_SUPABASE || {};
const accessCodes = {
  admin: "admin123",
  operator: "operador123",
  reader: "",
  ...(supabaseSettings.accessCodes || {}),
};
const roles = {
  admin: {
    label: "administrador",
    hint: "Administrador pode configurar metas, ondas, disparos e dados do painel.",
  },
  operator: {
    label: "operador",
    hint: "Operador pode atualizar quantas rotas subiram e foram carregadas.",
  },
  reader: {
    label: "leitor",
    hint: "Leitor apenas acompanha os indicadores e copia a mensagem pronta.",
  },
};
function getStoredRole() {
  try {
    return localStorage.getItem("expeditionAccessRole");
  } catch {
    return "reader";
  }
}

function saveStoredRole(role) {
  try {
    localStorage.setItem("expeditionAccessRole", role);
  } catch {
    return;
  }
}

let activeRole = roles[getStoredRole()] ? getStoredRole() : "reader";
const hasSupabaseConfig =
  Boolean(supabaseSettings.url) &&
  Boolean(supabaseSettings.anonKey) &&
  !supabaseSettings.url.includes("COLE_AQUI") &&
  !supabaseSettings.anonKey.includes("COLE_AQUI") &&
  window.supabase;
const supabaseClient = hasSupabaseConfig
  ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
  : null;
const statusId = supabaseSettings.statusId || "default";
let isApplyingRemoteState = false;
let saveTimer = null;
let isAutoDispatchEnabled = false;
let autoDispatchWindow = null;

function canEditSettings() {
  return activeRole === "admin" || activeRole === "operator";
}

function canUseAutoDispatch() {
  return activeRole === "admin" || activeRole === "operator";
}

function canEditWaveField(field) {
  if (activeRole === "admin" || activeRole === "operator") {
    return true;
  }

  return false;
}

function setActiveRole(role) {
  activeRole = roles[role] ? role : "reader";
  saveStoredRole(activeRole);
  applyAccessMode();
  refresh();
}

window.setActiveRole = setActiveRole;

function validateAccess(role, code) {
  const expectedCode = accessCodes[role] ?? "";
  return role === "reader" || String(code) === String(expectedCode);
}

function applyAccessMode() {
  const role = roles[activeRole] || roles.reader;
  document.body.dataset.role = activeRole;
  if (accessRoleSelect) {
    accessRoleSelect.value = activeRole;
  }
  if (accessStatus) {
    accessStatus.textContent = `Perfil atual: ${role.label}.`;
  }
  if (accessHint) {
    accessHint.textContent = role.hint;
  }

  [totalRoutesInput, targetPercentInput, managerNameInput, managerPhoneInput].forEach((input) => {
    input.disabled = !canEditSettings();
  });

  const balanceButton = document.querySelector("#balanceButton");
  if (balanceButton) {
    balanceButton.disabled = !canEditSettings();
  }
  autoDispatchButton.disabled = !canUseAutoDispatch();

  if (!canUseAutoDispatch() && isAutoDispatchEnabled) {
    isAutoDispatchEnabled = false;
    autoDispatchField.classList.remove("active");
    autoDispatchButton.textContent = "Ativar disparo automático";
    autoDispatchStatus.textContent = "Disponível apenas para administrador.";
  } else if (!canUseAutoDispatch()) {
    autoDispatchStatus.textContent = "Disponível apenas para administrador.";
  } else if (!isAutoDispatchEnabled) {
    autoDispatchStatus.textContent = "Inativo. Ao ativar, o painel abre o WhatsApp com a mensagem pronta a cada 15 min.";
  }
}

function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatPercent(value) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatRemainingTime(minutes) {
  if (minutes <= 0) {
    return "Encerrada";
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}min`;
}

function clampNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function getCleanPhone() {
  return managerPhoneInput.value.replace(/\D/g, "");
}

function getWhatsAppUrl(message = managerMessage.value) {
  const phone = getCleanPhone();
  const encodedMessage = encodeURIComponent(message);

  if (!phone) {
    return `https://web.whatsapp.com/send?text=${encodedMessage}`;
  }

  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodedMessage}`;
}

function getNowInMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getSentDispatchKeys() {
  try {
    return JSON.parse(localStorage.getItem("expeditionSentDispatches") || "{}");
  } catch {
    return {};
  }
}

function saveSentDispatchKey(key) {
  const sentDispatches = getSentDispatchKeys();
  sentDispatches[key] = true;
  localStorage.setItem("expeditionSentDispatches", JSON.stringify(sentDispatches));
}

function wasDispatchSent(key) {
  return Boolean(getSentDispatchKeys()[key]);
}

function getCurrentWave() {
  const nowMinutes = getNowInMinutes();
  return waves.find((wave) => nowMinutes >= toMinutes(wave.start) && nowMinutes < toMinutes(wave.end));
}

function updateSyncStatus(message) {
  syncStatus.textContent = message;
}

function getAppState() {
  return {
    totalRoutes: totalRoutesInput.value,
    targetPercent: targetPercentInput.value,
    managerName: managerNameInput.value,
    waves,
    updatedAt: new Date().toISOString(),
  };
}

function applyAppState(state) {
  if (!state || !Array.isArray(state.waves)) {
    return;
  }

  isApplyingRemoteState = true;
  totalRoutesInput.value = state.totalRoutes ?? totalRoutesInput.value;
  targetPercentInput.value = state.targetPercent ?? targetPercentInput.value;
  managerNameInput.value = state.managerName ?? managerNameInput.value;

  state.waves.forEach((wave, index) => {
    if (!waves[index]) {
      return;
    }

    waves[index].planned = clampNumber(wave.planned);
    waves[index].arrived = clampNumber(wave.arrived);
    waves[index].loaded = clampNumber(wave.loaded);
  });

  refresh();
  isApplyingRemoteState = false;
}

function scheduleSaveState() {
  if (!supabaseClient || isApplyingRemoteState) {
    return;
  }

  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

async function saveState() {
  if (!supabaseClient) {
    return;
  }

  updateSyncStatus("Salvando no Supabase...");

  const { error } = await supabaseClient
    .from("expedition_status")
    .upsert({
      id: statusId,
      payload: getAppState(),
      updated_at: new Date().toISOString(),
    });

  updateSyncStatus(error ? "Erro ao sincronizar" : "Sincronizado no Supabase");
}

async function loadState() {
  if (!supabaseClient) {
    updateSyncStatus("Sincronização local");
    return;
  }

  updateSyncStatus("Carregando Supabase...");

  const { data, error } = await supabaseClient
    .from("expedition_status")
    .select("payload")
    .eq("id", statusId)
    .maybeSingle();

  if (error) {
    updateSyncStatus("Erro ao carregar Supabase");
    return;
  }

  if (data?.payload) {
    applyAppState(data.payload);
  } else {
    await saveState();
  }

  updateSyncStatus("Sincronizado no Supabase");
}

function subscribeToRemoteChanges() {
  if (!supabaseClient) {
    return;
  }

  supabaseClient
    .channel("expedition-status-changes")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "expedition_status",
        filter: `id=eq.${statusId}`,
      },
      (payload) => {
        if (payload.new?.payload) {
          applyAppState(payload.new.payload);
          updateSyncStatus("Atualizado em tempo real");
        }
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        updateSyncStatus("Tempo real conectado");
      }
    });
}

function isWaveClosed(wave, nowMinutes) {
  return nowMinutes >= toMinutes(wave.end);
}

function isWaveOpen(wave, nowMinutes) {
  return nowMinutes < toMinutes(wave.end);
}

function getClosedLosses(nowMinutes) {
  return waves.reduce((sum, wave) => {
    if (!isWaveClosed(wave, nowMinutes)) {
      return sum;
    }

    return sum + Math.max(0, wave.planned - wave.loaded);
  }, 0);
}

function getWaveStatus(wave, allowedLoss) {
  const pending = Math.max(0, wave.planned - wave.loaded);
  if (pending <= allowedLoss) {
    return { label: "Ok", className: "ok" };
  }
  if (wave.loaded + allowedLoss >= Math.ceil(wave.planned * 0.75)) {
    return { label: "Atenção", className: "warning" };
  }
  return { label: "Crítico", className: "danger" };
}

function calculateWaveAllowedLosses(totalAllowedLoss, nowMinutes) {
  const closedLosses = getClosedLosses(nowMinutes);
  const remainingAllowedLoss = Math.max(0, totalAllowedLoss - closedLosses);
  const openWaves = waves
    .map((wave, index) => ({ ...wave, index }))
    .filter((wave) => isWaveOpen(wave, nowMinutes));
  const openPlannedTotal = openWaves.reduce((sum, wave) => sum + wave.planned, 0);

  if (openPlannedTotal === 0) {
    return waves.map(() => 0);
  }

  const distribution = waves.map((wave, index) => ({
    index,
    value: 0,
    remainder: 0,
  }));

  openWaves.forEach((wave) => {
    const exactShare = (wave.planned / openPlannedTotal) * remainingAllowedLoss;
    distribution[wave.index] = {
      index: wave.index,
      value: Math.floor(exactShare),
      remainder: exactShare % 1,
    };
  });

  let remainderToDistribute = remainingAllowedLoss - distribution.reduce((sum, item) => sum + item.value, 0);

  distribution
    .filter((item) => openWaves.some((wave) => wave.index === item.index))
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((item) => {
      if (remainderToDistribute > 0) {
        distribution[item.index].value += 1;
        remainderToDistribute -= 1;
      }
    });

  return distribution.map((item) => item.value);
}

function updateClock() {
  const now = new Date();
  const currentTime = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const currentWave = getCurrentWave();

  document.querySelector("#currentTime").textContent = currentTime;
  document.querySelector("#currentWaveLabel").textContent = currentWave
    ? `${currentWave.name} fecha às ${currentWave.end}`
    : "Fora das ondas configuradas";
}

function renderWaves() {
  const totalRoutes = clampNumber(totalRoutesInput.value);
  const targetPercent = clampNumber(targetPercentInput.value);
  const targetRoutes = Math.ceil(totalRoutes * (targetPercent / 100));
  const totalAllowedLoss = Math.max(0, totalRoutes - targetRoutes);
  const nowMinutes = getNowInMinutes();
  const allowedLosses = calculateWaveAllowedLosses(totalAllowedLoss, nowMinutes);

  wavesBody.innerHTML = waves
    .map((wave, index) => {
      const pending = Math.max(0, wave.planned - wave.loaded);
      const missingArrivals = Math.max(0, wave.planned - wave.arrived);
      const arrivedPercent = wave.planned === 0 ? 0 : (wave.arrived / wave.planned) * 100;
      const missingArrivalPercent = wave.planned === 0 ? 0 : (missingArrivals / wave.planned) * 100;
      const plannedDisabled = canEditWaveField("planned") ? "" : "disabled";
      const arrivedDisabled = canEditWaveField("arrived") ? "" : "disabled";
      const loadedDisabled = canEditWaveField("loaded") ? "" : "disabled";
      const isCurrentWave = nowMinutes >= toMinutes(wave.start) && nowMinutes < toMinutes(wave.end);
      const didNotStart = nowMinutes < toMinutes(wave.start);
      const remainingTime = isCurrentWave
        ? formatRemainingTime(toMinutes(wave.end) - nowMinutes)
        : didNotStart
          ? "Ainda não iniciou"
          : "Encerrada";
      const allowedLoss = allowedLosses[index];
      const status = isWaveClosed(wave, nowMinutes)
        ? pending > 0
          ? { label: `Perdeu ${pending}`, className: "danger" }
          : { label: "Fechada", className: "ok" }
        : getWaveStatus(wave, allowedLoss);

      return `
        <tr class="${isCurrentWave ? "current-wave" : ""}">
          <td><strong>${wave.name}</strong></td>
          <td>${wave.start} - ${wave.end}</td>
          <td><input type="number" min="0" value="${wave.planned}" data-index="${index}" data-field="planned" aria-label="Rotas planejadas da ${wave.name}" ${plannedDisabled}></td>
          <td><input type="number" min="0" value="${wave.arrived}" data-index="${index}" data-field="arrived" aria-label="Carros que subiram na ${wave.name}" ${arrivedDisabled}></td>
          <td>${formatPercent(arrivedPercent)}</td>
          <td>${missingArrivals}</td>
          <td>${formatPercent(missingArrivalPercent)}</td>
          <td><input type="number" min="0" value="${wave.loaded}" data-index="${index}" data-field="loaded" aria-label="Carros carregados na ${wave.name}" ${loadedDisabled}></td>
          <td>${pending}</td>
          <td>${allowedLoss}</td>
          <td>${remainingTime}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span></td>
        </tr>
      `;
    })
    .join("");
}

function updateSummary() {
  const totalRoutes = clampNumber(totalRoutesInput.value);
  const targetPercent = clampNumber(targetPercentInput.value);
  const nowMinutes = getNowInMinutes();
  const targetRoutes = Math.ceil(totalRoutes * (targetPercent / 100));
  const loadedRoutes = waves.reduce((sum, wave) => sum + wave.loaded, 0);
  const arrivedRoutes = waves.reduce((sum, wave) => sum + wave.arrived, 0);
  const shippedPercent = totalRoutes === 0 ? 0 : (loadedRoutes / totalRoutes) * 100;
  const routesToTarget = Math.max(0, targetRoutes - loadedRoutes);
  const dailyLossAllowance = Math.max(0, totalRoutes - targetRoutes);
  const closedLosses = getClosedLosses(nowMinutes);
  const remainingGeneralAllowance = Math.max(0, dailyLossAllowance - closedLosses);
  const pendingTotal = Math.max(0, totalRoutes - loadedRoutes);

  document.querySelector("#shippedPercent").textContent = formatPercent(shippedPercent);
  document.querySelector("#shippedRoutes").textContent = `${loadedRoutes} rotas carregadas`;
  document.querySelector("#totalPendingRoutes").textContent = pendingTotal;
  document.querySelector("#routesToTarget").textContent = routesToTarget;
  document.querySelector("#targetRoutes").textContent = `Meta: ${targetRoutes} rotas`;
  document.querySelector("#dailyLossAllowance").textContent = remainingGeneralAllowance;
  document.querySelector("#totalLossAllowance").textContent = `Perdas fechadas: ${closedLosses} de ${dailyLossAllowance}`;

  const statusCard = document.querySelector("#statusCard");
  const generalStatus = document.querySelector("#generalStatus");
  const generalStatusDetail = document.querySelector("#generalStatusDetail");
  statusCard.className = "metric-card status-card";

  if (loadedRoutes >= targetRoutes) {
    statusCard.classList.add("ok");
    generalStatus.textContent = "Meta batida";
    generalStatusDetail.textContent = `Você já atingiu ${targetPercent}% ou mais.`;
  } else if (closedLosses > dailyLossAllowance) {
    statusCard.classList.add("danger");
    generalStatus.textContent = "Meta em risco";
    generalStatusDetail.textContent = `As ondas fechadas já passaram da tolerância em ${closedLosses - dailyLossAllowance} rotas.`;
  } else if (pendingTotal <= routesToTarget) {
    statusCard.classList.add("danger");
    generalStatus.textContent = "Sem folga";
    generalStatusDetail.textContent = "Precisa carregar tudo que falta para buscar a meta.";
  } else {
    statusCard.classList.add("warning");
    generalStatus.textContent = "Acompanhar";
    generalStatusDetail.textContent = `Depois das ondas fechadas, ainda pode perder ${remainingGeneralAllowance} rotas.`;
  }

  const currentWave = getCurrentWave();
  const allowedLosses = calculateWaveAllowedLosses(dailyLossAllowance, nowMinutes);
  const currentWaveIndex = waves.indexOf(currentWave);
  const waveText = currentWave
    ? buildCurrentWaveMessage(currentWave, nowMinutes, allowedLosses[currentWaveIndex])
    : "Onda atual: fora do horário das ondas configuradas.";

  managerMessage.value = `${managerNameInput.value}
Status expedição ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}: temos ${totalRoutes} rotas planejadas no dia, ${loadedRoutes} carregadas, ${arrivedRoutes} carros que subiram e ${pendingTotal} rotas pendentes.
Indicador geral: estamos com ${formatPercent(shippedPercent)} expedido. A meta mínima é ${targetPercent}%, ou seja, precisamos carregar pelo menos ${targetRoutes} rotas.
Para bater a meta, ainda faltam ${routesToTarget} rotas. No geral, ainda faltam carregar ${pendingTotal} rotas. A tolerância total do dia é de ${dailyLossAllowance} rotas que podem ficar sem subir o qr.
As ondas já fechadas consumiram ${closedLosses} dessa tolerância. Por isso, a folga restante para a onda atual e as próximas é de ${remainingGeneralAllowance} rotas.
${waveText}`;
}

function buildCurrentWaveMessage(wave, nowMinutes, allowedLoss) {
  const missingArrivals = Math.max(0, wave.planned - wave.arrived);
  const pendingLoads = Math.max(0, wave.planned - wave.loaded);
  const arrivedPercent = wave.planned === 0 ? 0 : (wave.arrived / wave.planned) * 100;
  const missingArrivalPercent = wave.planned === 0 ? 0 : (missingArrivals / wave.planned) * 100;
  const remainingTime = formatRemainingTime(toMinutes(wave.end) - nowMinutes);

  return `Onda atual: ${wave.name} (${wave.start} até ${wave.end}). Tempo restante: ${remainingTime}.
Status da onda: ${wave.planned} planejadas, ${wave.arrived} subiram (${formatPercent(arrivedPercent)}), faltam subir ${missingArrivals} (${formatPercent(missingArrivalPercent)}), ${wave.loaded} carregadas e ${pendingLoads} pendentes para subir o qr.
Pela folga restante do indicador geral, esta onda pode encerrar com até ${allowedLoss} rotas sem subir o qr. Se passar disso, a folga das próximas ondas diminui.`;
}

function formatTimeFromMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function getDispatchSlots() {
  const slots = [];

  waves.forEach((wave, index) => {
    const startMinutes = toMinutes(wave.start);
    const endMinutes = toMinutes(wave.end);

    for (let slotMinutes = startMinutes + 15; slotMinutes <= endMinutes; slotMinutes += 15) {
      slots.push({
        id: `wave-${index}-${slotMinutes}`,
        minute: slotMinutes,
        wave,
        label: `${wave.name} - ${formatTimeFromMinutes(slotMinutes)}`,
      });
    }
  });

  return slots;
}

function getExpeditionTotals() {
  const totalRoutes = clampNumber(totalRoutesInput.value);
  const targetPercent = clampNumber(targetPercentInput.value);
  const targetRoutes = Math.ceil(totalRoutes * (targetPercent / 100));
  const loadedRoutes = waves.reduce((sum, wave) => sum + wave.loaded, 0);
  const arrivedRoutes = waves.reduce((sum, wave) => sum + wave.arrived, 0);
  const pendingTotal = Math.max(0, totalRoutes - loadedRoutes);
  const routesToTarget = Math.max(0, targetRoutes - loadedRoutes);

  return {
    arrivedRoutes,
    loadedRoutes,
    pendingTotal,
    routesToTarget,
    targetPercent,
    targetRoutes,
    totalRoutes,
  };
}

function buildAutomaticDispatchMessage(slot) {
  const totals = getExpeditionTotals();
  const currentTime = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (slot.isFinal) {
    return `${managerNameInput.value}
Fechamento das ondas ${currentTime}: temos ${totals.totalRoutes} rotas planejadas no dia, ${totals.loadedRoutes} carregadas e ${totals.pendingTotal} faltam carregar.
Para bater a meta de ${totals.targetPercent}%, ainda faltam ${totals.routesToTarget} rotas.`;
  }

  const wavePendingLoads = Math.max(0, slot.wave.planned - slot.wave.loaded);
  const waveMissingArrivals = Math.max(0, slot.wave.planned - slot.wave.arrived);

  return `${managerNameInput.value}
Atualização automática ${currentTime} - ${slot.wave.name}: ${slot.wave.planned} planejadas, ${slot.wave.loaded} carregadas, ${wavePendingLoads} faltam carregar e ${waveMissingArrivals} faltam subir o qr.
No geral, temos ${totals.totalRoutes} rotas planejadas, ${totals.loadedRoutes} carregadas e ${totals.pendingTotal} faltam carregar. Para bater a meta de ${totals.targetPercent}%, faltam ${totals.routesToTarget} rotas.`;
}

function addDispatchLog(message) {
  const item = document.createElement("p");
  item.textContent = message;
  dispatchLog.prepend(item);

  while (dispatchLog.children.length > 4) {
    dispatchLog.lastElementChild.remove();
  }
}

async function openAutomaticWhatsApp(message, slot) {
  managerMessage.value = message;
  updateWhatsAppLink();

  try {
    await navigator.clipboard.writeText(message);
  } catch {
    managerMessage.select();
  }

  const whatsappUrl = getWhatsAppUrl(message);

  if (autoDispatchWindow && !autoDispatchWindow.closed) {
    autoDispatchWindow.location.href = whatsappUrl;
  } else {
    autoDispatchWindow = window.open(whatsappUrl, "expeditionAutoDispatch");
  }

  copyFeedback.textContent = `Disparo preparado: ${slot.label}.`;
  addDispatchLog(`${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} - ${slot.label}: mensagem pronta no WhatsApp.`);
}

function checkAutomaticDispatches() {
  if (!isAutoDispatchEnabled) {
    return;
  }

  const nowMinutes = getNowInMinutes();
  const todayKey = getTodayKey();
  const dueSlots = getDispatchSlots().filter((item) => item.minute === nowMinutes);

  if (dueSlots.length === 0) {
    return;
  }

  dueSlots.forEach((slot) => {
    const dispatchKey = `${todayKey}-${slot.id}`;
    if (wasDispatchSent(dispatchKey)) {
      return;
    }

    saveSentDispatchKey(dispatchKey);
    openAutomaticWhatsApp(buildAutomaticDispatchMessage(slot), slot);
  });
}

function loginWithSelectedRole() {
  const requestedRole = accessRoleSelect.value;
  const code = accessCodeInput.value.trim();

  if (!validateAccess(requestedRole, code)) {
    if (accessStatus) {
      accessStatus.textContent = "Código incorreto para este perfil.";
    }
    accessCodeInput.focus();
    return;
  }

  setActiveRole(requestedRole);
  accessCodeInput.value = "";
  copyFeedback.textContent = `Perfil ${roles[activeRole].label} ativado.`;
}

function refresh() {
  updateClock();
  renderWaves();
  updateSummary();
  updateWhatsAppLink();
}

function updateWhatsAppLink() {
  const whatsappUrl = getWhatsAppUrl();

  if (!whatsappUrl) {
    whatsappLink.classList.remove("visible");
    whatsappLink.removeAttribute("href");
    return;
  }

  whatsappLink.href = whatsappUrl;
  whatsappLink.classList.add("visible");
}

wavesBody.addEventListener("input", (event) => {
  const input = event.target;
  const index = Number(input.dataset.index);
  const field = input.dataset.field;

  if (!Number.isInteger(index) || !field || !canEditWaveField(field)) {
    refresh();
    return;
  }

  waves[index][field] = clampNumber(input.value);
  if (field === "loaded" && waves[index].arrived < waves[index].loaded) {
    waves[index].arrived = waves[index].loaded;
  }

  refresh();
  scheduleSaveState();
});

[totalRoutesInput, targetPercentInput, managerNameInput, managerPhoneInput].forEach((input) => {
  input.addEventListener("input", () => {
    if (!canEditSettings()) {
      refresh();
      return;
    }

    refresh();

    if (input !== managerPhoneInput) {
      scheduleSaveState();
    }
  });
});

document.querySelector("#balanceButton").addEventListener("click", () => {
  if (!canEditSettings()) {
    copyFeedback.textContent = "Apenas administrador pode redistribuir as rotas.";
    return;
  }

  const totalRoutes = clampNumber(totalRoutesInput.value);
  const base = Math.floor(totalRoutes / waves.length);
  const remainder = totalRoutes % waves.length;

  waves.forEach((wave, index) => {
    wave.planned = base + (index < remainder ? 1 : 0);
  });

  refresh();
  scheduleSaveState();
});

document.querySelector("#copyButton").addEventListener("click", async () => {
  copyFeedback.textContent = "";

  try {
    await navigator.clipboard.writeText(managerMessage.value);
    copyFeedback.textContent = "Mensagem copiada.";
  } catch {
    managerMessage.select();
    document.execCommand("copy");
    copyFeedback.textContent = "Mensagem selecionada para copiar.";
  }
});

document.querySelector("#whatsappButton").addEventListener("click", () => {
  const phone = getCleanPhone();
  const whatsappUrl = getWhatsAppUrl();

  if (phone && phone.length < 12) {
    copyFeedback.textContent = "Confira o numero. Para Brasil, use 55 + DDD + numero.";
    managerPhoneInput.focus();
    return;
  }

  copyFeedback.textContent = phone
    ? "Abrindo WhatsApp Web com a mensagem pronta."
    : "Abrindo WhatsApp Web. Selecione o grupo e envie a mensagem pronta.";
  window.open(whatsappUrl, "_blank", "noopener");
});

autoDispatchButton.addEventListener("click", () => {
  if (!canUseAutoDispatch()) {
    copyFeedback.textContent = "Apenas administrador pode ativar disparo automático.";
    return;
  }

  isAutoDispatchEnabled = !isAutoDispatchEnabled;
  autoDispatchField.classList.toggle("active", isAutoDispatchEnabled);
  autoDispatchButton.textContent = isAutoDispatchEnabled ? "Desativar disparo automático" : "Ativar disparo automático";

  if (!isAutoDispatchEnabled) {
    autoDispatchStatus.textContent = "Inativo. Ao ativar, o painel abre o WhatsApp com a mensagem pronta a cada 15 min.";
    copyFeedback.textContent = "Disparo automático desativado.";
    return;
  }

  autoDispatchWindow = window.open("", "expeditionAutoDispatch");
  if (autoDispatchWindow) {
    autoDispatchWindow.document.write("<p>Aba reservada para os disparos automáticos do painel de expedição.</p>");
  }

  autoDispatchStatus.textContent = "Ativo. Dispara 15, 30 e 45 min após o início de cada onda. O disparo de 45 min é o fechamento da onda.";
  copyFeedback.textContent = "Disparo automático ativado. Deixe esta aba do painel aberta.";
  addDispatchLog("Disparo automático ativado. O painel vai preparar a mensagem nos horários programados.");
  checkAutomaticDispatches();
});

if (accessLoginButton && !window.simpleAccessLogin) {
  accessLoginButton.addEventListener("click", loginWithSelectedRole);
}

if (accessCodeInput && !window.simpleAccessLogin) {
  accessCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loginWithSelectedRole();
    }
  });
}

if (accessLogoutButton && !window.simpleAccessLogout) {
  accessLogoutButton.addEventListener("click", () => {
    setActiveRole("reader");
    accessCodeInput.value = "";
    copyFeedback.textContent = "Perfil leitor ativado.";
  });
}

if (accessRoleSelect) {
  accessRoleSelect.addEventListener("change", () => {
    const selectedRole = roles[accessRoleSelect.value] || roles.reader;
    if (accessHint) {
      accessHint.textContent = selectedRole.hint;
    }
  });
}

applyAccessMode();
refresh();
loadState();
subscribeToRemoteChanges();
setInterval(() => {
  refresh();
  checkAutomaticDispatches();
}, 30000);
