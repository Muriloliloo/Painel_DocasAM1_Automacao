(() => {
  const STYLE_ID = "closure-status-module-style";
  const CARD_ID = "closureStatusCard";
  const CHART_ID = "closureStatusChart";

  // =========================================================
  // VISUAL
  // =========================================================

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
      #fechamentoView .closure-layout.closure-status-enabled {
        width: 100%;
        grid-template-columns:
          minmax(500px, .95fr)
          minmax(290px, 330px)
          minmax(500px, 1fr) !important;
      }

      .closure-status-card {
        min-width: 0;
        overflow: hidden;
        padding: 18px;
        border: 1px solid #c7d3df;
        border-radius: 8px;
        background: #ffffff;
        color: #063354;
        box-shadow: 0 3px 10px rgba(5, 41, 77, .09);
      }

      .closure-status-header {
        text-align: center;
        margin-bottom: 8px;
      }

      .closure-status-header strong {
        display: block;
        color: #263746;
        font: 900 16px/1.05 "Segoe UI", Arial, sans-serif;
        text-transform: uppercase;
      }

      .closure-status-header small {
        display: block;
        margin-top: 6px;
        color: #70808d;
        font: 800 10px/1.15 "Segoe UI", Arial, sans-serif;
      }

      .closure-status-legend {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        margin: 12px 0 18px;
        color: #59636c;
        font: 800 10px/1 "Segoe UI", Arial, sans-serif;
      }

      .closure-status-legend span {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
      }

      .closure-status-dot {
        width: 10px;
        height: 10px;
        display: inline-block;
        border-radius: 50%;
      }

      .closure-status-dot.within {
        background: #20ad3a;
      }

      .closure-status-dot.outside {
        background: #f01825;
      }

      .closure-status-dot.pending {
        background: #e6b800;
      }

      .closure-status-chart {
        min-height: 220px;
        display: grid;
        grid-template-columns: repeat(5, minmax(72px, 1fr));
        align-items: end;
        gap: 12px;
      }

      .closure-status-wave {
        min-width: 0;
        display: grid;
        gap: 6px;
        text-align: center;
      }

      .closure-status-bar {
        position: relative;
        width: 100%;
        height: 160px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        overflow: hidden;
        border: 1px solid #c8d1d8;
        border-radius: 3px 3px 0 0;
        background: #eef2f5;
      }

      .closure-status-segment {
        width: 100%;
        flex: 0 0 auto;
      }

      .closure-status-segment.pending {
        background: #e6b800;
      }

      .closure-status-segment.outside {
        background: #f01825;
      }

      .closure-status-segment.within {
        background: #20ad3a;
      }

      .closure-status-percent {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #ffffff;
        font: 900 18px/1 "Segoe UI", Arial, sans-serif;
        text-shadow: 0 1px 2px rgba(0, 0, 0, .38);
        pointer-events: none;
      }

      .closure-status-percent.zero {
        color: #263746;
        text-shadow: none;
      }

      .closure-status-wave-name {
        overflow: hidden;
        color: #4e5861;
        font: 900 11px/1 "Segoe UI", Arial, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .closure-status-wave-time,
      .closure-status-wave-counts {
        overflow: hidden;
        color: #78858f;
        font: 800 9px/1.15 "Segoe UI", Arial, sans-serif;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .closure-status-empty {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #87939c;
        font: 900 10px/1 "Segoe UI", Arial, sans-serif;
      }

      body.dark-mode .closure-status-card {
        border-color: #294b66;
        background: #0d263b;
        color: #edf7ff;
      }

      body.dark-mode .closure-status-header strong,
      body.dark-mode .closure-status-wave-name {
        color: #edf7ff;
      }

      body.dark-mode .closure-status-header small,
      body.dark-mode .closure-status-legend,
      body.dark-mode .closure-status-wave-time,
      body.dark-mode .closure-status-wave-counts {
        color: #afc0cd;
      }

      body.dark-mode .closure-status-bar {
        border-color: #34536c;
        background: #18384f;
      }

      body.dark-mode .closure-status-percent.zero {
        color: #edf7ff;
      }

      @media (max-width: 1550px) {
        #fechamentoView .closure-layout.closure-status-enabled {
          grid-template-columns:
            minmax(500px, 1fr)
            minmax(290px, 330px) !important;
        }

        #fechamentoView .closure-status-card {
          grid-column: 1 / -1;
        }
      }

      @media (max-width: 900px) {
        #fechamentoView .closure-layout.closure-status-enabled {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        #fechamentoView .closure-status-card {
          grid-column: auto;
        }

        .closure-status-chart {
          grid-template-columns: repeat(2, minmax(100px, 1fr));
        }
      }
    `;

    document.head.appendChild(style);
  }

  // =========================================================
  // DATA OPERACIONAL
  // =========================================================

  function operationalDayStart() {
    const raw = String(data?.data || "");
    const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);

    const date = new Date();

    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]) - 1;
      const year = Number(match[3]);

      date.setFullYear(year, month, day);
    }

    date.setHours(0, 0, 0, 0);

    return date;
  }

  // =========================================================
  // HORÁRIO LIMITE DA ONDA
  // =========================================================

  function waveEndTimestamp(wave) {
    const time = parseWaveTime(wave);

    if (!time?.fim) return 0;

    const parts = String(time.fim).split(":");
    const hour = Number(parts[0]);
    const minute = Number(parts[1]);

    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return 0;
    }

    const date = operationalDayStart();

    date.setHours(hour, minute, 59, 999);

    return date.getTime();
  }

  // =========================================================
  // HORÁRIO REAL EM QUE A ROTA FOI EXPEDIDA
  // =========================================================

  function routeCompletionTimestamp(route) {
    const historyRows = routeHistoryRows(route);
    const lifecycle = routeLifecycleTimes(route, historyRows);
    const details = routeCurrentDetails(route);
    const milestones = historyMilestones(details, historyRows, lifecycle);
    const completed = Number(milestones?.completed || 0);

    if (!completed) return 0;

    /*
      Evita utilizar um registro de outro dia caso o mesmo
      código de rota apareça novamente em outra operação.
    */
    const start = operationalDayStart().getTime();
    const end = start + (24 * 60 * 60 * 1000);

    if (completed < start || completed >= end) {
      return 0;
    }

    return completed;
  }

  // =========================================================
  // REGRA DO GRÁFICO
  //
  // VERDE:
  // rota expedida até o término da onda
  //
  // VERMELHO:
  // rota expedida depois do término da onda
  //
  // AMARELO:
  // rota ainda não expedida
  //
  // Os três juntos representam 100% das rotas planejadas.
  // =========================================================

  function waveStatusBreakdown(wave) {
    const rows = plannedRows(wave);

    const planned = rows.length;
    const cutoff = waveEndTimestamp(wave);

    let within = 0;
    let outside = 0;
    let pending = 0;

    rows.forEach(row => {
      const completed = routeCompletionTimestamp(row.rota);

      if (!completed) {
        pending += 1;
        return;
      }

      if (!cutoff) {
        pending += 1;
        return;
      }

      if (completed <= cutoff) {
        within += 1;
      } else {
        outside += 1;
      }
    });

    return {
      planned,
      within,
      outside,
      pending
    };
  }

  // =========================================================
  // PERCENTUAIS
  // =========================================================

  function percent(value, total) {
    if (!total) return 0;

    return (value / total) * 100;
  }

  function percentLabel(value) {
    const rounded = Math.round(value * 10) / 10;

    const decimals =
      Math.abs(rounded - Math.round(rounded)) < 0.001
        ? 0
        : 1;

    return `${rounded
      .toFixed(decimals)
      .replace(".", ",")}%`;
  }

  // =========================================================
  // CRIA O CARD NA ABA FECHAMENTO
  // =========================================================

  function ensureCard() {
    const layout = document.querySelector(
      "#fechamentoView .closure-layout"
    );

    if (!layout) return null;

    layout.classList.add("closure-status-enabled");

    let card = document.getElementById(CARD_ID);

    if (card) return card;

    card = document.createElement("section");

    card.id = CARD_ID;
    card.className = "closure-status-card";

    card.setAttribute(
      "aria-label",
      "Resumo de expedição por status"
    );

    card.innerHTML = `
      <header class="closure-status-header">

        <strong>
          RESUMO EXPEDIÇÃO POR STATUS
        </strong>

        <small>
          Percentual de rotas expedidas dentro do target de cada onda
        </small>

      </header>

      <div class="closure-status-legend">

        <span>
          <i class="closure-status-dot within"></i>
          DENTRO DO TARGET
        </span>

        <span>
          <i class="closure-status-dot outside"></i>
          FORA DO TARGET
        </span>

        <span>
          <i class="closure-status-dot pending"></i>
          PENDENTE
        </span>

      </div>

      <div
        class="closure-status-chart"
        id="${CHART_ID}">
      </div>
    `;

    layout.appendChild(card);

    return card;
  }

  // =========================================================
  // DESENHA O GRÁFICO
  // =========================================================

  function renderClosureStatusChart() {
    injectStyles();

    const card = ensureCard();

    if (!card) return;

    const chart = document.getElementById(CHART_ID);

    if (!chart) return;

    const waves = Array.isArray(data?.ondas)
      ? data.ondas
      : [];

    chart.innerHTML = waves.map(wave => {

      const result = waveStatusBreakdown(wave);

      const waveName = displayWave(wave);

      const waveSchedule = parseWaveTime(wave);

      const timeLabel =
        waveSchedule?.inicio && waveSchedule?.fim
          ? `${waveSchedule.inicio} - ${waveSchedule.fim}`
          : "Sem horário";

      // -----------------------------------------------------
      // ONDA SEM ROTAS
      // -----------------------------------------------------

      if (!result.planned) {
        return `
          <article class="closure-status-wave">

            <div class="closure-status-bar">

              <span class="closure-status-empty">
                SEM DADOS
              </span>

            </div>

            <strong class="closure-status-wave-name">
              ${waveName}
            </strong>

            <span class="closure-status-wave-time">
              ${timeLabel}
            </span>

            <span class="closure-status-wave-counts">
              0 rotas
            </span>

          </article>
        `;
      }

      // -----------------------------------------------------
      // CÁLCULO PERCENTUAL
      // -----------------------------------------------------

      const withinPct =
        percent(
          result.within,
          result.planned
        );

      const outsidePct =
        percent(
          result.outside,
          result.planned
        );

      const pendingPct =
        percent(
          result.pending,
          result.planned
        );

      /*
        Exemplo:

        10 planejadas
        8 dentro do target
        1 fora do target
        1 pendente

        Verde    = 80%
        Vermelho = 10%
        Amarelo  = 10%
      */

      return `
        <article
          class="closure-status-wave"
          title="
            ${waveName}
            | Dentro: ${result.within}
            | Fora: ${result.outside}
            | Pendente: ${result.pending}
          ">

          <div class="closure-status-bar">

            ${
              pendingPct > 0
                ? `
                  <span
                    class="closure-status-segment pending"
                    style="height:${pendingPct.toFixed(3)}%">
                  </span>
                `
                : ""
            }

            ${
              outsidePct > 0
                ? `
                  <span
                    class="closure-status-segment outside"
                    style="height:${outsidePct.toFixed(3)}%">
                  </span>
                `
                : ""
            }

            ${
              withinPct > 0
                ? `
                  <span
                    class="closure-status-segment within"
                    style="height:${withinPct.toFixed(3)}%">
                  </span>
                `
                : ""
            }

            <strong
              class="closure-status-percent ${
                withinPct <= 0 ? "zero" : ""
              }">

              ${percentLabel(withinPct)}

            </strong>

          </div>

          <strong class="closure-status-wave-name">
            ${waveName}
          </strong>

          <span class="closure-status-wave-time">
            ${timeLabel}
          </span>

          <span class="closure-status-wave-counts">

            ${result.within}/${result.planned}
            dentro

            ·

            ${result.outside}
            fora

            ·

            ${result.pending}
            pend.

          </span>

        </article>
      `;

    }).join("");
  }

  // =========================================================
  // ATUALIZA AUTOMATICAMENTE QUANDO O FECHAMENTO MUDA
  // =========================================================

  function startClosureStatusModule() {
    renderClosureStatusChart();

    const closureContent =
      document.getElementById("closureContent");

    if (!closureContent) return;

    let updateQueued = false;

    const observer = new MutationObserver(() => {

      if (updateQueued) return;

      updateQueued = true;

      requestAnimationFrame(() => {

        updateQueued = false;

        renderClosureStatusChart();

      });
    });

    observer.observe(
      closureContent,
      {
        childList: true,
        subtree: true,
        characterData: true
      }
    );
  }

  // =========================================================
  // INICIALIZAÇÃO
  // =========================================================

  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      startClosureStatusModule,
      { once: true }
    );

  } else {

    startClosureStatusModule();

  }

})();