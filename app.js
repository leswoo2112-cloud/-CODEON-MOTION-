/* 실버스타 스포츠 과학원 · CODEON MOTION
   app.js — 대시보드, 화면 이동, 공통 UI, 백업 설정
*/

(() => {
  "use strict";

  window.CM = window.CM || {};
  const CM = window.CM;

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const escape = (value) => CM.escape(String(value ?? ""));

  let toastTimer = null;
  let currentRoute = "";
  let requestedRoute = "";
  let routing = false;
  let started = false;
  let settingsBusy = false;

  CM.selectedAthlete = CM.selectedAthlete || "";
  CM.selectedExercise = CM.selectedExercise || "";
  CM.selectedRecord = CM.selectedRecord || null;

  /* ──────────────────────────────
     공통 화면 요소
  ────────────────────────────── */

  CM.heading = (title, eyebrow = "", actions = "") => `
    <div class="row spread" style="margin-bottom:22px;gap:16px;flex-wrap:wrap">
      <div>
        ${
          eyebrow
            ? `<div class="muted"
                 style="color:var(--accent);font-size:11px;
                 letter-spacing:2px;margin-bottom:8px">
                 ${escape(eyebrow)}
               </div>`
            : ""
        }
        <h1 style="margin:0">${escape(title)}</h1>
      </div>
      ${
        actions
          ? `<div class="row no-print" style="gap:8px;flex-wrap:wrap">
               ${actions}
             </div>`
          : ""
      }
    </div>
  `;

  CM.empty = (message = "아직 저장된 데이터가 없습니다.") => `
    <div class="empty">
      <p>${escape(message)}</p>
    </div>
  `;

  CM.toast = (message, duration = 3500) => {
    const node = $("#toast");
    if (!node) {
      console.info(String(message));
      return;
    }

    clearTimeout(toastTimer);

    node.textContent = String(message ?? "");
    node.hidden = false;
    node.style.display = "block";
    node.classList.add("show");

    toastTimer = setTimeout(() => {
      node.classList.remove("show");
      node.style.display = "none";
      node.hidden = true;
    }, duration);
  };

  CM.modal = (html, onOpen) => {
    const dialog = $("#modal");
    const body = $("#modal-body");

    if (!dialog || !body) {
      throw new Error("index.html의 modal 요소를 찾을 수 없습니다.");
    }

    // 이전 창의 비동기 저장과 이벤트가 섞이지 않도록 합니다.
    if (dialog.open) {
      CM.toast("현재 창을 먼저 닫아 주세요.");
      return null;
    }

    body.innerHTML = html;

    if (typeof dialog.showModal !== "function") {
      body.innerHTML = "";
      throw new Error("이 브라우저에서는 대화상자를 지원하지 않습니다.");
    }

    dialog.showModal();

    if (typeof onOpen === "function") {
      try {
        Promise.resolve(onOpen(dialog)).catch(handleError);
      } catch (error) {
        handleError(error);
      }
    }

    return dialog;
  };

  function handleError(error) {
    console.error(error);

    const message =
      error instanceof Error
        ? error.message
        : "작업 중 오류가 발생했습니다.";

    CM.toast(message || "작업 중 오류가 발생했습니다.", 6000);
  }

  function setMenu(open) {
    document.body.classList.toggle("menu-open", Boolean(open));

    const menu = $("#menu");
    if (menu) {
      menu.setAttribute("aria-expanded", String(Boolean(open)));
    }
  }

  function dateText(value) {
    if (!value) return "날짜 없음";

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "날짜 없음";

    return date.toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function recordDate(record) {
    const time = new Date(
      record.createdAt || record.date || 0
    ).getTime();

    return Number.isFinite(time) ? time : 0;
  }

  function recordExercise(record) {
    return (
      record.exercise?.name ||
      CM.exercises?.find(
        (exercise) => exercise.id === record.exerciseId
      )?.name ||
      "운동 정보 없음"
    );
  }

  function recordAthlete(record, athletes) {
    if (!record.athleteId) return "게스트";

    return (
      athletes.find(
        (athlete) => athlete.id === record.athleteId
      )?.name ||
      record.athleteName ||
      "삭제된 선수"
    );
  }

  function metric(label, value, detail = "") {
    return `
      <div class="panel metric">
        <div class="muted">${escape(label)}</div>
        <div style="font-size:30px;font-weight:800;margin:10px 0;
                    color:var(--accent)">
          ${escape(value)}
        </div>
        <div class="muted" style="font-size:12px">
          ${escape(detail)}
        </div>
      </div>
    `;
  }

  /* ──────────────────────────────
     대시보드
  ────────────────────────────── */

  CM.renderHome = async () => {
    await CM.loadExercises();

    const [athletes, records, training] = await Promise.all([
      CM.db.all("athletes"),
      CM.db.all("records"),
      CM.db.all("training")
    ]);

    records.sort((a, b) => recordDate(b) - recordDate(a));

    const recent = records.slice(0, 8);
    const today = CM.trainingToday();
    const todaysTraining = training.filter(
      (item) => item.date === today
    );

    const todaysDone = todaysTraining.filter(
      (item) => item.done
    ).length;

    const pendingTraining = training.filter(
      (item) => !item.done
    ).length;

    const activeAthlete = athletes.find(
      (athlete) => athlete.id === CM.selectedAthlete
    );

    const main = $("#main");

    main.innerHTML = `
      ${CM.heading(
        "실버스타 스포츠 과학원",
        "CODEON MOTION · PERFORMANCE DASHBOARD",
        `<button class="primary" data-route="analysis">
           자세 분석 시작
         </button>`
      )}

      <section class="panel" style="margin-bottom:20px">
        <div class="row spread" style="gap:16px;flex-wrap:wrap">
          <div>
            <span class="badge">코드온 · 웨이트 동작 분석</span>
            <h2 style="margin-top:14px">
              기록을 바탕으로 움직임을 확인하세요.
            </h2>
            <p class="muted">
              선수 등록부터 자세 분석, 기록 비교,
              코치 피드백과 추가 훈련까지 연결합니다.
            </p>
          </div>
          <div>
            <div class="muted">현재 선택 선수</div>
            <strong style="display:block;margin:8px 0">
              ${escape(activeAthlete?.name || "게스트")}
            </strong>
            <button class="small" data-route="athletes">
              선수 선택
            </button>
          </div>
        </div>
      </section>

      <div class="grid g4" style="margin-bottom:20px">
        ${metric("등록 선수", athletes.length, "선수 프로필")}
        ${metric("분석 기록", records.length, "저장 완료 기록")}
        ${metric("운동 라이브러리", CM.exercises.length, "사용자 등록 운동 포함")}
        ${metric(
          "오늘 훈련 완료",
          `${todaysDone} / ${todaysTraining.length}`,
          "직접 표시한 완료 상태"
        )}
      </div>

      <div class="grid g2" style="margin-bottom:20px">
        <section class="panel">
          <h2>빠른 시작</h2>
          <div class="grid g2">
            <button data-route="athletes">선수 등록·선택</button>
            <button data-route="exercises">운동 종목 찾기</button>
            <button data-route="analysis">카메라·영상 분석</button>
            <button data-route="compare">두 기록 비교</button>
            <button data-route="reports">분석 리포트</button>
            <button data-route="training">추가 훈련</button>
          </div>
        </section>

        <section class="panel">
          <h2>분석에서 확인할 항목</h2>
          <p class="muted">
            좌우 관절 각도, 몸통 기울기, 시간에 따른 변화,
            반복 구간과 직접 지정한 궤적을 확인할 수 있습니다.
          </p>
          <p class="muted">
            육각형 평가는 코치가 기준과 점수를 입력합니다.
            자동 반복 감지는 실험 기능이며 기록을 확인한 뒤 사용하세요.
          </p>
          <span class="badge">
            미완료 훈련 ${pendingTraining}건
          </span>
        </section>
      </div>

      <section class="panel" style="margin-bottom:20px">
        <div class="row spread" style="gap:12px;flex-wrap:wrap">
          <h2>최근 분석 기록</h2>
          <button class="small" data-route="reports">
            전체 기록 보기
          </button>
        </div>

        ${
          recent.length
            ? `
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>분석 일시</th>
                      <th>선수</th>
                      <th>운동</th>
                      <th>촬영 방향</th>
                      <th>저장 표본</th>
                      <th>리포트</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${recent.map((record) => `
                      <tr>
                        <td>
                          ${escape(dateText(
                            record.createdAt || record.date
                          ))}
                        </td>
                        <td>${escape(recordAthlete(record, athletes))}</td>
                        <td>${escape(recordExercise(record))}</td>
                        <td>
                          ${escape(
                            ({
                              front: "정면",
                              side: "측면",
                              back: "후면"
                            })[record.view] || "미지정"
                          )}
                        </td>
                        <td>
                          ${
                            Array.isArray(record.samples)
                              ? record.samples.length
                              : 0
                          }
                        </td>
                        <td>
                          <button class="small"
                            data-open-record="${escape(record.id)}">
                            열기
                          </button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            `
            : CM.empty(
                "저장된 분석 기록이 없습니다. 선수를 선택하고 첫 분석을 시작하세요."
              )
        }
      </section>

      <section class="notice">
        데이터는 현재 브라우저에 저장됩니다.
        다른 기기에서 사용하거나 데이터를 보관하려면
        설정에서 JSON 백업을 내려받으세요.
        원본 영상은 JSON 백업에 포함되지 않습니다.
      </section>
    `;

    main.addEventListener("click", (event) => {
      const button = event.target.closest("[data-open-record]");
      if (!button) return;

      const record = records.find(
        (item) => item.id === button.dataset.openRecord
      );

      if (!record) return;

      CM.selectedRecord = record.id;
      CM.selectedAthlete = record.athleteId || "";
      location.hash = "reports";
    }, { signal: pageController.signal });
  };

  /* ──────────────────────────────
     설정 / 백업
  ────────────────────────────── */

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "확인 불가";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;

    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }

    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  CM.renderSettings = async () => {
    const [athletes, records, training, media] = await Promise.all([
      CM.db.count("athletes"),
      CM.db.count("records"),
      CM.db.count("training"),
      CM.db.count("media")
    ]);

    const main = $("#main");

    main.innerHTML = `
      ${CM.heading("시스템 설정", "SYSTEM · DATA MANAGEMENT")}

      <div class="grid g4" style="margin-bottom:20px">
        ${metric("선수", athletes, "저장된 프로필")}
        ${metric("분석 기록", records, "저장된 분석")}
        ${metric("훈련", training, "완료·미완료 포함")}
        ${metric("원본 미디어", media, "브라우저에 저장된 항목")}
      </div>

      <div class="grid g2">
        <section class="panel">
          <h2>데이터 백업</h2>
          <p class="muted">
            선수, 분석 기록, 훈련, 설정을 JSON 파일로 저장합니다.
            원본 영상은 별도로 보관하세요.
          </p>
          <button id="settings-backup" class="primary">
            JSON 백업 다운로드
          </button>
        </section>

        <section class="panel">
          <h2>백업 가져오기</h2>
          <p class="muted">
            이 프로그램에서 만든 JSON 백업을 가져옵니다.
            같은 ID의 데이터는 백업 내용으로 덮어쓰며,
            다른 ID의 기존 데이터는 유지합니다.
          </p>
          <label>
            백업 파일 선택
            <input id="settings-restore-file"
              type="file" accept=".json,application/json">
          </label>
          <button id="settings-restore" style="margin-top:12px">
            선택한 백업 가져오기
          </button>
          <p class="muted" style="font-size:12px">
            가져오기 전에 현재 데이터를 먼저 백업해 주세요.
          </p>
        </section>

        <section class="panel">
          <h2>브라우저 저장 공간</h2>
          <p id="settings-space" class="muted">확인 중…</p>
          <p id="settings-persistence" class="muted"></p>
          <button id="settings-persist">
            저장 공간 유지 요청
          </button>
          <p class="muted" style="font-size:12px">
            브라우저가 요청을 허용해도 사용자가 사이트 데이터를
            삭제하면 기록이 사라집니다. 백업은 별도로 보관하세요.
          </p>
        </section>

        <section class="panel">
          <h2>실행 환경</h2>
          <p>
            보안 연결:
            <strong>${window.isSecureContext ? "사용 중" : "사용 안 함"}</strong>
          </p>
          <p>
            카메라 API:
            <strong>
              ${navigator.mediaDevices?.getUserMedia ? "지원" : "확인 필요"}
            </strong>
          </p>
          <p class="muted">
            카메라 분석은 HTTPS 또는 localhost에서 실행하고
            브라우저의 카메라 권한을 허용해야 합니다.
            자세 인식 모델을 불러올 때 인터넷 연결이 필요합니다.
          </p>
        </section>
      </div>

      <section class="panel" style="margin-top:20px">
        <h2>분석값 안내</h2>
        <p class="muted">
          화면에 표시되는 관절 각도는 영상에서 추정한
          2D 기준점으로 계산합니다.
          촬영 방향, 가림, 조명과 기준점 인식 상태에 따라
          결과가 달라질 수 있습니다.
        </p>
        <p class="muted">
          운동 라이브러리의 종목 등록과 종목별 정확도 검증은
          별개입니다. 모든 종목의 자동 반복 감지나 자세 판정이
          검증된 것은 아닙니다.
          리포트의 코치 평가와 실제 측정값을 구분해 확인하세요.
        </p>
      </section>
    `;

    const backupButton = $("#settings-backup");
    const restoreButton = $("#settings-restore");
    const fileInput = $("#settings-restore-file");
    const persistButton = $("#settings-persist");

    function setBusy(busy) {
      settingsBusy = busy;

      for (const node of [
        backupButton,
        restoreButton,
        fileInput,
        persistButton
      ]) {
        node.disabled = busy;
      }
    }

    backupButton.addEventListener("click", async () => {
      if (settingsBusy) return;

      setBusy(true);
      try {
        await CM.db.backup();
        CM.toast("백업 파일 다운로드를 요청했습니다.");
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }
    });

    restoreButton.addEventListener("click", async () => {
      if (settingsBusy) return;

      const file = fileInput.files?.[0];

      if (!file) {
        CM.toast("가져올 JSON 백업 파일을 선택해 주세요.");
        return;
      }

      const approved = window.confirm(
        "백업을 가져올까요?\n\n" +
        "같은 ID의 데이터는 백업 내용으로 덮어씁니다.\n" +
        "다른 기존 데이터는 유지합니다.\n" +
        "원본 영상은 복원되지 않습니다."
      );

      if (!approved) return;

      setBusy(true);

      let restored = false;

      try {
        await CM.db.restore(file);
        await CM.loadExercises();

        CM.selectedRecord = null;
        CM.trainingDraft = null;

        const selected = CM.selectedAthlete
          ? await CM.db.get("athletes", CM.selectedAthlete)
          : null;

        if (!selected) CM.selectedAthlete = "";

        restored = true;
        CM.toast("백업 데이터를 가져왔습니다.");
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }

      if (restored && currentRoute === "settings") {
        await CM.renderSettings();
      }
    });

    async function refreshStorageInfo() {
      const space = $("#settings-space", main);
      const persistence = $("#settings-persistence", main);

      try {
        if (navigator.storage?.estimate) {
          const estimate = await navigator.storage.estimate();

          space.textContent =
            `이 사이트 사용량 약 ${formatBytes(estimate.usage)} / ` +
            `브라우저 제공 한도 약 ${formatBytes(estimate.quota)}`;
        } else {
          space.textContent =
            "이 브라우저에서는 저장 공간 조회를 지원하지 않습니다.";
        }

        if (navigator.storage?.persisted) {
          const persisted = await navigator.storage.persisted();
          persistence.textContent = persisted
            ? "저장 공간 유지: 허용됨"
            : "저장 공간 유지: 아직 허용되지 않음";
        } else {
          persistence.textContent =
            "저장 공간 유지 상태를 조회할 수 없습니다.";
        }
      } catch (error) {
        space.textContent = "저장 공간 정보를 확인하지 못했습니다.";
        console.warn(error);
      }

      persistButton.disabled =
        settingsBusy || !navigator.storage?.persist;
    }

    persistButton.addEventListener("click", async () => {
      if (settingsBusy || !navigator.storage?.persist) return;

      setBusy(true);

      try {
        const granted = await navigator.storage.persist();

        CM.toast(
          granted
            ? "브라우저가 저장 공간 유지 요청을 허용했습니다."
            : "브라우저가 요청을 허용하지 않았습니다. JSON 백업을 이용하세요."
        );
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
        await refreshStorageInfo();
      }
    });

    await refreshStorageInfo();
  };

  /* ──────────────────────────────
     메뉴 / 라우터
  ────────────────────────────── */

  const menuItems = [
    { route: "home", label: "대시보드", icon: "⌂" },
    { route: "athletes", label: "선수 관리", icon: "♙" },
    { route: "exercises", label: "운동 라이브러리", icon: "◇" },
    { route: "analysis", label: "자세 분석", icon: "◎" },
    { route: "compare", label: "기록 비교", icon: "⇄" },
    { route: "reports", label: "분석 리포트", icon: "▤" },
    { route: "feedback", label: "코치 피드백", icon: "✎" },
    { route: "training", label: "추가 훈련", icon: "▦" },
    { route: "settings", label: "시스템 설정", icon: "⚙" }
  ];

  const renderers = {
    home: () => CM.renderHome(),
    athletes: () => CM.renderAthletes(),
    exercises: () => CM.renderExercises(),
    analysis: () => CM.renderAnalysis(),
    compare: () => CM.renderCompare(),
    reports: () => CM.renderReports(),
    feedback: () => CM.renderFeedback(),
    training: () => CM.renderTraining(),
    settings: () => CM.renderSettings()
  };

  // 화면별 위임 이벤트는 이동 시 한꺼번에 제거합니다.
  let pageController = new AbortController();

  function normalizeRoute(value) {
    const route = String(value || "")
      .replace(/^#\/?/, "")
      .split("?")[0];

    const aliases = {
      dashboard: "home",
      records: "reports",
      report: "reports",
      system: "settings"
    };

    const resolved = aliases[route] || route || "home";

    return Object.prototype.hasOwnProperty.call(
      renderers,
      resolved
    ) ? resolved : "home";
  }

  function replaceHash(route) {
    const url = new URL(location.href);
    url.hash = route;
    history.replaceState(history.state, "", url);
  }

  function buildNav() {
    const nav = $("#nav");
    if (!nav) return;

    nav.innerHTML = menuItems.map((item) => `
      <a href="#${item.route}" data-nav="${item.route}">
        <span aria-hidden="true">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `).join("");
  }

  function updateNav(route) {
    document.querySelectorAll("[data-nav]").forEach((node) => {
      const active = node.dataset.nav === route;
      node.classList.toggle("active", active);

      if (active) {
        node.setAttribute("aria-current", "page");
      } else {
        node.removeAttribute("aria-current");
      }
    });

    const title = menuItems.find(
      (item) => item.route === route
    )?.label || "대시보드";

    document.title = `${title} · 실버스타 스포츠 과학원`;
    setMenu(false);
  }

  async function canLeaveCurrentPage() {
    if (settingsBusy) {
      CM.toast("데이터 작업이 끝난 뒤 이동해 주세요.");
      return false;
    }

    if ($("#modal")?.open) {
      CM.toast("열려 있는 창을 먼저 저장하거나 닫아 주세요.");
      return false;
    }

    const guards = [
      CM.analysisCanLeave,
      CM.reportsCanLeave
    ];

    for (const guard of guards) {
      if (typeof guard !== "function") continue;
      if ((await guard()) === false) return false;
    }

    return true;
  }

  async function cleanupCurrentPage() {
    pageController.abort();
    pageController = new AbortController();

    for (const name of [
      "analysisCleanup",
      "compareCleanup",
      "reportsCleanup"
    ]) {
      const cleanup = CM[name];

      if (typeof cleanup !== "function") continue;

      try {
        await cleanup();
      } catch (error) {
        console.error(`${name} 오류`, error);
      } finally {
        CM[name] = null;
      }
    }

    CM.analysisCanLeave = null;
    CM.reportsCanLeave = null;
  }

  async function processRoutes() {
    if (routing || !started) return;

    routing = true;

    try {
      while (requestedRoute) {
        const target = requestedRoute;
        requestedRoute = "";

        if (target === currentRoute) {
          replaceHash(currentRoute);
          continue;
        }

        if (!(await canLeaveCurrentPage())) {
          requestedRoute = "";
          replaceHash(currentRoute || "home");
          break;
        }

        await cleanupCurrentPage();

        currentRoute = target;
        replaceHash(target);
        updateNav(target);

        const main = $("#main");

        main.setAttribute("aria-busy", "true");
        main.innerHTML = `
          <section class="panel">
            <p class="muted" role="status">화면을 불러오는 중입니다…</p>
          </section>
        `;

        try {
          await renderers[target]();
          window.scrollTo(0, 0);
        } catch (error) {
          await cleanupCurrentPage();
          console.error(error);

          main.innerHTML = `
            ${CM.heading("화면을 불러오지 못했습니다", "CODEON MOTION")}
            <section class="panel">
              <p>${escape(error?.message || "알 수 없는 오류")}</p>
              <p class="muted">
                파일명과 index.html의 스크립트 연결 순서를
                확인한 뒤 다시 시도해 주세요.
              </p>
              <div class="row" style="gap:8px;flex-wrap:wrap">
                <button id="route-retry" class="primary">다시 시도</button>
                <button data-route="home">대시보드</button>
              </div>
            </section>
          `;

          $("#route-retry").addEventListener("click", () => {
            currentRoute = "";
            requestRoute(target);
          }, { signal: pageController.signal });
        } finally {
          main.removeAttribute("aria-busy");
        }
      }
    } finally {
      routing = false;

      if (requestedRoute) {
        void processRoutes().catch(handleError);
      }
    }
  }

  function requestRoute(route) {
    requestedRoute = normalizeRoute(route);
    void processRoutes().catch(handleError);
  }

  CM.navigate = (route) => {
    const normalized = normalizeRoute(route);

    if (normalizeRoute(location.hash) === normalized) {
      requestRoute(normalized);
    } else {
      location.hash = normalized;
    }
  };

  /* ──────────────────────────────
     초기화
  ────────────────────────────── */

  function bindGlobalEvents() {
    $("#menu")?.addEventListener("click", () => {
      setMenu(!document.body.classList.contains("menu-open"));
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setMenu(false);
    });

    document.addEventListener("click", (event) => {
      const routeButton = event.target.closest("[data-route]");

      if (routeButton) {
        event.preventDefault();
        CM.navigate(routeButton.dataset.route);
        return;
      }

      if (
        document.body.classList.contains("menu-open") &&
        !event.target.closest("#sidebar") &&
        !event.target.closest("#menu")
      ) {
        setMenu(false);
      }
    });

    const dialog = $("#modal");
    const closeButton = $("#modal-close");

    closeButton?.addEventListener("click", () => {
      if (!dialog?.open) return;

      // 各フォームの保存中キャンセル防止処理を尊重します。
      const cancelEvent = new Event("cancel", {
        cancelable: true
      });

      if (dialog.dispatchEvent(cancelEvent) && dialog.open) {
        dialog.close();
      }
    });

    window.addEventListener("hashchange", () => {
      requestRoute(location.hash);
    });

    window.addEventListener("beforeunload", (event) => {
      if (!settingsBusy) return;

      event.preventDefault();
      event.returnValue = "";
    });
  }

  function checkModules() {
    const required = [
      ["storage.js", typeof CM.db?.open === "function"],
      ["exercises.js", typeof CM.loadExercises === "function"],
      ["charts.js", typeof CM.lineChart === "function"],
      ["athletes.js", typeof CM.renderAthletes === "function"],
      ["analysis.js", typeof CM.renderAnalysis === "function"],
      ["compare.js", typeof CM.renderCompare === "function"],
      ["reports.js", typeof CM.renderReports === "function"],
      ["training.js", typeof CM.renderTraining === "function"]
    ];

    const missing = required
      .filter(([, available]) => !available)
      .map(([filename]) => filename);

    if (missing.length) {
      throw new Error(
        `불러오지 못한 파일: ${missing.join(", ")}`
      );
    }
  }

  async function start() {
    const main = $("#main");

    try {
      if (!main) {
        throw new Error("index.html에 main 요소가 필요합니다.");
      }

      checkModules();
      buildNav();
      bindGlobalEvents();

      await CM.db.open();
      await CM.loadExercises();

      if (
        !CM.exercises.some(
          (exercise) => exercise.id === CM.selectedExercise
        )
      ) {
        CM.selectedExercise = CM.exercises[0]?.id || "";
      }

      started = true;
      requestRoute(location.hash || "home");
    } catch (error) {
      console.error(error);

      if (main) {
        // storage.js가 누락된 상황에서도 오류를 표시합니다.
        const panel = document.createElement("section");
        panel.className = "panel";

        const title = document.createElement("h1");
        title.textContent = "프로그램을 시작하지 못했습니다";

        const detail = document.createElement("p");
        detail.textContent =
          error?.message || "초기화 중 오류가 발생했습니다.";

        const guide = document.createElement("p");
        guide.className = "muted";
        guide.textContent =
          "12개 파일을 같은 폴더에 저장하고 " +
          "index.html의 스크립트 연결 순서를 확인해 주세요.";

        const retry = document.createElement("button");
        retry.className = "primary";
        retry.textContent = "새로고침";
        retry.addEventListener("click", () => location.reload());

        panel.append(title, detail, guide, retry);
        main.replaceChildren(panel);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {
      once: true
    });
  } else {
    void start();
  }
})();