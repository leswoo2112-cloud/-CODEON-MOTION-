/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   training.js

   선수별 추가 훈련 계획
   운동 선택 / 세트 / 횟수 / 유지 시간 / 휴식 / 중량
   보완점 / 다음 목표 / 수행 메모
   완료 표시 / 수정 / 삭제 / CSV

   리포트에서 전달하는 CM.trainingDraft를 사용합니다.
   훈련은 코치 또는 사용자가 직접 선택합니다.
   ========================================================= */

"use strict";

window.CM = window.CM || {};

/* ---------------------------------------------------------
   날짜·훈련 표시 도구
   --------------------------------------------------------- */

CM.trainingToday = function () {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
};

CM.trainingExerciseName = function (item) {
  if (item.exerciseName) {
    return item.exerciseName;
  }

  return CM.exercises.find(exercise => {
    return exercise.id === item.exerciseId;
  })?.name || "운동";
};

CM.trainingVolumeLabel = function (item) {
  const parts = [
    String(item.sets || 0) + "세트"
  ];

  if (Number.isFinite(item.reps) && item.reps > 0) {
    parts.push(item.reps + "회");
  }

  if (
    Number.isFinite(item.holdSeconds) &&
    item.holdSeconds > 0
  ) {
    parts.push(item.holdSeconds + "초");
  }

  if (Number.isFinite(item.weight)) {
    parts.push(item.weight + "kg");
  }

  return parts.join(" · ");
};

/* ---------------------------------------------------------
   등록·수정 창
   --------------------------------------------------------- */

CM.openTrainingForm = async function (
  existing = null,
  draft = null,
  onSaved = null
) {
  await CM.loadExercises();

  const athletes = await CM.db.all("athletes");

  athletes.sort((a, b) => {
    return a.name.localeCompare(b.name, "ko");
  });

  const editing = Boolean(existing);

  const current = existing || {
    athleteId:
      draft?.athleteId ??
      CM.selectedAthlete ??
      "",

    athleteName:
      draft?.athleteName || "",

    sourceRecordId:
      draft?.sourceRecordId || null,

    exerciseId: "",

    sets: 3,
    reps: null,
    holdSeconds: null,
    restSeconds: 60,
    weight: null,

    date: CM.trainingToday(),

    reason: draft?.reason || "",
    goal: draft?.goal || "",

    notes: "",
    done: false
  };

  const sourceRecord = current.sourceRecordId
    ? await CM.db.get("records", current.sourceRecordId)
    : null;

  const missingAthlete =
    current.athleteId &&
    !athletes.some(athlete => {
      return athlete.id === current.athleteId;
    });

  const athleteOptions = [
    '<option value="">임시 훈련 · 선수 미지정</option>',

    ...athletes.map(athlete => `
      <option
        value="${CM.escape(athlete.id)}"
        ${athlete.id === current.athleteId ? "selected" : ""}
      >
        ${CM.escape(athlete.name)}
        ${athlete.team ? " · " + CM.escape(athlete.team) : ""}
      </option>
    `),

    missingAthlete
      ? `
        <option
          value="${CM.escape(current.athleteId)}"
          selected
        >
          ${CM.escape(current.athleteName || "기존 선수")}
          · 프로필 삭제됨
        </option>
      `
      : ""
  ].join("");

  CM.modal(
    `
      <h2>
        ${editing ? "훈련 계획 수정" : "추가 훈련 등록"}
      </h2>

      <form id="training-form" class="stack">
        <label>
          선수
          <select id="tf-athlete" name="athleteId">
            ${athleteOptions}
          </select>
        </label>

        <div class="form-grid">
          <label>
            운동 분류
            <select id="tf-category">
              <option value="all">전체</option>

              ${CM.categories.map(category => `
                <option>${category}</option>
              `).join("")}
            </select>
          </label>

          <label>
            운동 검색
            <input
              id="tf-search"
              type="search"
              placeholder="운동 이름·별칭"
            >
          </label>
        </div>

        <label>
          훈련 운동 *
          <select
            id="tf-exercise"
            name="exerciseId"
            required
          ></select>
        </label>

        <div id="tf-exercise-preview"></div>

        <div class="form-grid">
          <label>
            훈련 날짜 *
            <input
              name="date"
              type="date"
              required
              value="${CM.escape(current.date || CM.trainingToday())}"
            >
          </label>

          <label>
            세트 *
            <input
              name="sets"
              type="number"
              min="1"
              max="100"
              step="1"
              required
              value="${CM.escape(current.sets ?? 3)}"
            >
          </label>

          <label>
            세트당 횟수
            <input
              name="reps"
              type="number"
              min="1"
              max="9999"
              step="1"
              value="${CM.escape(current.reps ?? "")}"
              placeholder="횟수 운동"
            >
          </label>

          <label>
            세트당 유지·수행 시간 · 초
            <input
              name="holdSeconds"
              type="number"
              min="1"
              max="86400"
              step="1"
              value="${CM.escape(current.holdSeconds ?? "")}"
              placeholder="시간 운동"
            >
          </label>

          <label>
            세트 사이 휴식 · 초
            <input
              name="restSeconds"
              type="number"
              min="0"
              max="86400"
              step="1"
              value="${CM.escape(current.restSeconds ?? 60)}"
            >
          </label>

          <label>
            중량 · kg · 선택
            <input
              name="weight"
              type="number"
              min="0"
              max="1000"
              step="0.5"
              value="${CM.escape(current.weight ?? "")}"
              placeholder="입력하지 않아도 됩니다."
            >
          </label>
        </div>

        <p class="notice">
          세트당 횟수 또는 시간을 하나 이상 입력하세요.
          양쪽을 수행하는 운동은 횟수 기준을 메모에 적어 주세요.
        </p>

        <label>
          연결된 보완점·훈련 선택 이유
          <textarea
            name="reason"
            maxlength="3000"
            placeholder="리포트에서 확인한 부위·방향·장면"
          >${CM.escape(current.reason || "")}</textarea>
        </label>

        <label>
          다음 측정 목표
          <textarea
            name="goal"
            maxlength="3000"
            placeholder="다음 분석에서 확인할 항목"
          >${CM.escape(current.goal || "")}</textarea>
        </label>

        <label>
          수행 메모
          <textarea
            name="notes"
            maxlength="3000"
            placeholder="좌우 횟수 기준, 실제 수행량, 코치 지시 등"
          >${CM.escape(current.notes || "")}</textarea>
        </label>

        ${
          current.sourceRecordId
            ? `
              <div class="notice">
                연결 리포트:
                ${
                  sourceRecord
                    ? CM.escape(CM.reportRecordLabel(sourceRecord))
                    : "기존 리포트를 찾을 수 없습니다."
                }
              </div>

              <label class="row">
                <input
                  id="tf-keep-source"
                  type="checkbox"
                  ${sourceRecord ? "checked" : ""}
                >
                기존 리포트 연결 유지
              </label>
            `
            : ""
        }

        <label class="row">
          <input
            name="done"
            type="checkbox"
            ${current.done ? "checked" : ""}
          >
          이 훈련을 완료했어요
        </label>

        <button
          id="tf-save"
          type="submit"
          class="primary"
        >
          ${editing ? "변경 내용 저장" : "훈련 등록"}
        </button>
      </form>
    `,

    function () {
      const form = document.querySelector("#training-form");

      const category = document.querySelector("#tf-category");
      const search = document.querySelector("#tf-search");
      const exerciseSelect = document.querySelector("#tf-exercise");
      const preview = document.querySelector("#tf-exercise-preview");

      const saveButton = document.querySelector("#tf-save");
      const closeButton = document.querySelector("#modal-close");
      const dialog = document.querySelector("#modal");

      let saving = false;

      function selectedExercise() {
        return CM.exercises.find(exercise => {
          return exercise.id === exerciseSelect.value;
        });
      }

      function drawPreview() {
        const exercise = selectedExercise();

        preview.innerHTML = exercise
          ? `
            <div class="row">
              <div style="width:110px">
                ${CM.icon(exercise)}
              </div>

              <div>
                <strong>${CM.escape(exercise.name)}</strong>

                <small style="display:block">
                  ${CM.escape(exercise.category)}
                  ·
                  ${CM.escape(exercise.equipment)}
                </small>
              </div>
            </div>
          `
          : '<p class="notice">등록할 운동을 선택하세요.</p>';
      }

      function drawExerciseOptions(preferredId = "") {
        const query = CM.exerciseSearchKey(search.value);

        const exercises = CM.exercises.filter(exercise => {
          const matchesCategory =
            category.value === "all" ||
            exercise.category === category.value;

          const matchesQuery =
            !query ||
            CM.exerciseSearchKey(
              exercise.name + " " + exercise.aliases
            ).includes(query);

          return matchesCategory && matchesQuery;
        });

        exerciseSelect.innerHTML =
          '<option value="">운동 선택</option>' +
          exercises.map(exercise => `
            <option value="${CM.escape(exercise.id)}">
              ${CM.escape(exercise.name)}
              · ${CM.escape(exercise.equipment)}
            </option>
          `).join("");

        if (
          preferredId &&
          exercises.some(exercise => exercise.id === preferredId)
        ) {
          exerciseSelect.value = preferredId;
        }

        drawPreview();
      }

      const originalExercise = CM.exercises.find(exercise => {
        return exercise.id === current.exerciseId;
      });

      if (originalExercise) {
        category.value = originalExercise.category;
      }

      drawExerciseOptions(current.exerciseId);

      category.onchange = function () {
        drawExerciseOptions(exerciseSelect.value);
      };

      search.oninput = function () {
        drawExerciseOptions(exerciseSelect.value);
      };

      exerciseSelect.onchange = drawPreview;

      function preventCancel(event) {
        if (saving) event.preventDefault();
      }

      dialog.addEventListener("cancel", preventCancel);

      dialog.addEventListener(
        "close",
        function () {
          dialog.removeEventListener("cancel", preventCancel);
        },
        { once: true }
      );

      form.onsubmit = async function (event) {
        event.preventDefault();

        if (saving || !form.reportValidity()) return;

        const values = new FormData(form);
        const exercise = selectedExercise();

        if (!exercise) {
          CM.toast("훈련 운동을 선택하세요.");
          return;
        }

        function numberOrNull(key) {
          const text = String(values.get(key) || "").trim();

          return text === "" ? null : Number(text);
        }

        const sets = numberOrNull("sets");
        const reps = numberOrNull("reps");
        const holdSeconds = numberOrNull("holdSeconds");
        const restSeconds = numberOrNull("restSeconds");
        const weight = numberOrNull("weight");

        if (
          !Number.isInteger(sets) ||
          sets < 1 ||
          sets > 100
        ) {
          CM.toast("세트는 1~100의 정수로 입력하세요.");
          return;
        }

        if (
          !(Number.isFinite(reps) && reps > 0) &&
          !(Number.isFinite(holdSeconds) && holdSeconds > 0)
        ) {
          CM.toast("횟수 또는 시간을 하나 이상 입력하세요.");
          return;
        }

        const athleteId = String(values.get("athleteId") || "");

        const athlete = athletes.find(item => {
          return item.id === athleteId;
        });

        const keepSource =
          document.querySelector("#tf-keep-source")?.checked;

        if (
          keepSource &&
          sourceRecord &&
          (sourceRecord.athleteId || "") !== athleteId
        ) {
          CM.toast(
            "연결 리포트와 선수가 다릅니다. 선수를 맞추거나 리포트 연결을 해제하세요."
          );

          return;
        }

        const done = values.get("done") === "on";
        const now = new Date().toISOString();

        saving = true;
        saveButton.disabled = true;
        closeButton.disabled = true;

        try {
          const latest = editing
            ? await CM.db.get("training", existing.id)
            : null;

          if (editing && !latest) {
            throw new Error("이 훈련 기록은 이미 삭제되었습니다.");
          }

          const updated = {
            ...(latest || {}),

            id: existing?.id || CM.uid(),

            athleteId,

            athleteName:
              athlete?.name ||
              (
                athleteId === current.athleteId
                  ? current.athleteName
                  : ""
              ) ||
              "임시 훈련",

            exerciseId: exercise.id,
            exerciseName: exercise.name,
            category: exercise.category,
            equipment: exercise.equipment,
            icon: exercise.icon,

            sets,
            reps,
            holdSeconds,
            restSeconds,
            weight,

            date: String(values.get("date")),

            reason: String(values.get("reason") || "").trim(),
            goal: String(values.get("goal") || "").trim(),
            notes: String(values.get("notes") || "").trim(),

            sourceRecordId:
              keepSource && sourceRecord
                ? sourceRecord.id
                : null,

            done,

            doneAt: done
              ? latest?.doneAt || now
              : null,

            createdAt: latest?.createdAt || now,
            updatedAt: now
          };

          await CM.db.put("training", updated);

          if (draft && CM.trainingDraft === draft) {
            CM.trainingDraft = null;
          }

          CM.selectedAthlete = athleteId;

          dialog.close();

          CM.toast(
            editing
              ? "훈련 계획을 수정했습니다."
              : "추가 훈련을 등록했습니다."
          );

          if (typeof onSaved === "function") {
            try {
              await onSaved(updated);
            } catch (_) {
              CM.toast(
                "저장은 완료했습니다. 화면을 새로고침해 주세요."
              );
            }
          }
        } catch (error) {
          CM.toast(error.message || "훈련 저장에 실패했습니다.");
        } finally {
          saving = false;
          saveButton.disabled = false;
          closeButton.disabled = false;
        }
      };
    }
  );
};

/* ---------------------------------------------------------
   CSV
   --------------------------------------------------------- */

CM.exportTrainingCSV = function (items) {
  const header = [
    "선수",
    "날짜",
    "운동",
    "세트",
    "세트당 횟수",
    "세트당 시간(초)",
    "휴식(초)",
    "중량(kg)",
    "완료",
    "완료 시각",
    "보완점",
    "다음 목표",
    "수행 메모"
  ];

  const rows = items.map(item => [
    item.athleteName,
    item.date,
    CM.trainingExerciseName(item),
    item.sets,
    item.reps,
    item.holdSeconds,
    item.restSeconds,
    item.weight,
    item.done ? "완료" : "미완료",
    item.doneAt || "",
    item.reason || "",
    item.goal || "",
    item.notes || ""
  ]);

  const csv = [
    header,
    ...rows
  ].map(row => row.map(CM.csvCell).join(",")).join("\r\n");

  CM.download(
    "codeon-training.csv",
    "\uFEFF" + csv,
    "text/csv;charset=utf-8"
  );
};

/* ---------------------------------------------------------
   훈련 관리 화면
   --------------------------------------------------------- */

CM.renderTraining = async function () {
  await CM.loadExercises();

  let [items, athletes] = await Promise.all([
    CM.db.all("training"),
    CM.db.all("athletes")
  ]);

  const main = document.querySelector("#main");

  const athleteMap = new Map(
    athletes.map(athlete => [
      athlete.id,
      athlete.name
    ])
  );

  // 선수 프로필이 삭제되어도 과거 훈련을 찾을 수 있게 합니다.
  for (const item of items) {
    if (item.athleteId && !athleteMap.has(item.athleteId)) {
      athleteMap.set(
        item.athleteId,
        (item.athleteName || "기존 선수") + " · 프로필 없음"
      );
    }
  }

  const draft = CM.trainingDraft || null;

  if (
    draft?.athleteId &&
    !athleteMap.has(draft.athleteId)
  ) {
    athleteMap.set(
      draft.athleteId,
      draft.athleteName || "리포트 선수"
    );
  }

  main.innerHTML =
    CM.heading(
      "추가 훈련",
      "TRAINING PLAN",
      `
        <button id="tr-add" class="primary">
          + 훈련 등록
        </button>
      `
    ) +
    `
      ${
        draft
          ? `
            <section id="tr-draft" class="panel">
              <h2>리포트에서 연결된 보완점</h2>

              <p style="white-space:pre-wrap">${CM.escape(
                draft.reason || "보완점을 직접 입력해 주세요."
              )}</p>

              <p class="notice" style="white-space:pre-wrap">${CM.escape(
                draft.goal || "다음 측정 목표를 설정할 수 있습니다."
              )}</p>

              <div class="row">
                <button id="tr-draft-add" class="primary">
                  이 보완점으로 훈련 작성
                </button>

                <button id="tr-draft-dismiss">
                  연결 초안 닫기
                </button>
              </div>
            </section>
          `
          : ""
      }

      <section class="panel no-print">
        <div class="form-grid">
          <label>
            선수
            <select id="tr-athlete">
              <option value="all">전체 선수</option>
              <option value="guest">임시 훈련</option>

              ${[...athleteMap.entries()]
                .sort((a, b) => a[1].localeCompare(b[1], "ko"))
                .map(([id, name]) => `
                  <option value="${CM.escape(id)}">
                    ${CM.escape(name)}
                  </option>
                `).join("")}
            </select>
          </label>

          <label>
            수행 상태
            <select id="tr-status">
              <option value="all">전체</option>
              <option value="pending">미완료</option>
              <option value="done">완료</option>
              <option value="overdue">예정일 지남 · 미완료</option>
            </select>
          </label>

          <label>
            운동·메모 검색
            <input
              id="tr-search"
              type="search"
              placeholder="운동, 보완점, 목표 검색"
            >
          </label>

          <label>
            훈련 날짜
            <input id="tr-date" type="date">
          </label>
        </div>

        <div class="row" style="margin-top:14px">
          <button id="tr-today">오늘</button>
          <button id="tr-all-dates">전체 날짜</button>
          <button id="tr-export">조회 결과 CSV</button>
        </div>
      </section>

      <section class="panel">
        <div class="grid g4">
          <div>
            <small>조회된 계획</small>
            <div id="tr-total" class="metric">0</div>
          </div>

          <div>
            <small>완료</small>
            <div id="tr-done" class="metric">0</div>
          </div>

          <div>
            <small>미완료</small>
            <div id="tr-pending" class="metric">0</div>
          </div>

          <div>
            <small>계획 완료율</small>
            <div id="tr-rate" class="metric">—</div>
          </div>
        </div>

        <p class="notice">
          완료율은 사용자가 완료 표시한 계획의 비율입니다.
          자세 정확도나 운동 효과를 뜻하지 않습니다.
        </p>
      </section>

      <section class="panel">
        <h2>훈련 계획</h2>

        <div id="tr-list"></div>
      </section>
    `;

  const $ = id => document.getElementById(id);

  let mutationBusy = false;

  function filteredItems() {
    const athlete = $("tr-athlete").value;
    const status = $("tr-status").value;
    const query = $("tr-search").value
      .trim()
      .toLocaleLowerCase("ko");

    const date = $("tr-date").value;
    const today = CM.trainingToday();

    return items
      .filter(item => {
        const matchesAthlete =
          athlete === "all" ||
          (
            athlete === "guest"
              ? !item.athleteId
              : item.athleteId === athlete
          );

        const matchesStatus =
          status === "all" ||
          (status === "done" && item.done) ||
          (status === "pending" && !item.done) ||
          (
            status === "overdue" &&
            !item.done &&
            item.date &&
            item.date < today
          );

        const text = [
          CM.trainingExerciseName(item),
          item.athleteName,
          item.reason,
          item.goal,
          item.notes
        ].join(" ").toLocaleLowerCase("ko");

        return (
          matchesAthlete &&
          matchesStatus &&
          (!date || item.date === date) &&
          (!query || text.includes(query))
        );
      })
      .sort((a, b) => {
        const first = String(a.date || "");
        const second = String(b.date || "");

        return (
          first.localeCompare(second) ||
          (Number(Boolean(a.done)) - Number(Boolean(b.done)))
        );
      });
  }

  function draw() {
    const visible = filteredItems();
    const completed = visible.filter(item => item.done).length;
    const today = CM.trainingToday();

    $("tr-total").textContent = visible.length;
    $("tr-done").textContent = completed;
    $("tr-pending").textContent = visible.length - completed;

    $("tr-rate").textContent = visible.length
      ? Math.round(completed / visible.length * 100) + "%"
      : "—";

    if (!visible.length) {
      $("tr-list").innerHTML = CM.empty(
        "조건에 맞는 훈련 계획이 없습니다."
      );

      return;
    }

    $("tr-list").innerHTML = `
      <div class="stack">
        ${visible.map(item => {
          const exercise =
            CM.exercises.find(ex => ex.id === item.exerciseId) ||
            {
              name: CM.trainingExerciseName(item),
              icon: "squat"
            };

          const overdue =
            !item.done &&
            item.date &&
            item.date < today;

          return `
            <article class="feedback-card">
              <div class="row spread">
                <div class="row">
                  <div style="width:85px">
                    ${CM.icon(exercise)}
                  </div>

                  <div>
                    <small>
                      ${CM.escape(item.athleteName || "임시 훈련")}
                      ·
                      ${CM.escape(item.date || "날짜 미지정")}
                    </small>

                    <h3 style="margin:4px 0">
                      ${CM.escape(CM.trainingExerciseName(item))}
                    </h3>

                    <p>
                      ${CM.escape(CM.trainingVolumeLabel(item))}
                    </p>

                    <small>
                      휴식 ${CM.fmt(item.restSeconds, 0)}초
                    </small>
                  </div>
                </div>

                <span
                  class="badge ${item.done ? "training-complete" : ""}"
                >
                  ${
                    item.done
                      ? "완료"
                      : overdue
                        ? "예정일 지남"
                        : "미완료"
                  }
                </span>
              </div>

              ${
                item.reason
                  ? `
                    <div style="margin-top:14px">
                      <small>연결된 보완점</small>
                      <p style="white-space:pre-wrap">${CM.escape(
                        item.reason
                      )}</p>
                    </div>
                  `
                  : ""
              }

              ${
                item.goal
                  ? `
                    <div style="margin-top:10px">
                      <small>다음 측정 목표</small>
                      <p style="white-space:pre-wrap">${CM.escape(
                        item.goal
                      )}</p>
                    </div>
                  `
                  : ""
              }

              ${
                item.notes
                  ? `
                    <details style="margin-top:12px">
                      <summary>수행 메모</summary>

                      <p style="white-space:pre-wrap">${CM.escape(
                        item.notes
                      )}</p>
                    </details>
                  `
                  : ""
              }

              <div class="row no-print" style="margin-top:16px">
                <button
                  type="button"
                  class="${item.done ? "" : "primary"}"
                  data-training-action="toggle"
                  data-training-id="${CM.escape(item.id)}"
                >
                  ${item.done ? "완료 취소" : "완료 표시"}
                </button>

                <button
                  type="button"
                  data-training-action="edit"
                  data-training-id="${CM.escape(item.id)}"
                >
                  수정
                </button>

                ${
                  item.sourceRecordId
                    ? `
                      <button
                        type="button"
                        data-training-action="report"
                        data-training-id="${CM.escape(item.id)}"
                      >
                        연결 리포트
                      </button>
                    `
                    : ""
                }

                <button
                  type="button"
                  data-training-action="analyze"
                  data-training-id="${CM.escape(item.id)}"
                >
                  이 운동 분석
                </button>

                <button
                  type="button"
                  class="danger"
                  data-training-action="delete"
                  data-training-id="${CM.escape(item.id)}"
                >
                  삭제
                </button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  async function reloadItems() {
    items = await CM.db.all("training");
    draw();
  }

  function safe(handler) {
    return async function (event) {
      try {
        await handler(event);
      } catch (error) {
        CM.toast(error.message || "훈련 작업에 실패했습니다.");
      }
    };
  }

  function currentFilterAthlete() {
    const value = $("tr-athlete").value;

    return value !== "all" && value !== "guest"
      ? value
      : "";
  }

  $("tr-add").onclick = safe(async function () {
    const athleteId = currentFilterAthlete();

    await CM.openTrainingForm(
      null,
      {
        athleteId,
        athleteName: athleteMap.get(athleteId) || "임시 훈련"
      },
      CM.renderTraining
    );
  });

  if (draft) {
    $("tr-draft-add").onclick = safe(async function () {
      await CM.openTrainingForm(
        null,
        draft,
        CM.renderTraining
      );
    });

    $("tr-draft-dismiss").onclick = function () {
      if (CM.trainingDraft === draft) {
        CM.trainingDraft = null;
      }

      $("tr-draft").remove();
    };
  }

  $("tr-athlete").onchange = draw;
  $("tr-status").onchange = draw;
  $("tr-search").oninput = draw;
  $("tr-date").onchange = draw;

  $("tr-today").onclick = function () {
    $("tr-date").value = CM.trainingToday();
    draw();
  };

  $("tr-all-dates").onclick = function () {
    $("tr-date").value = "";
    draw();
  };

  $("tr-export").onclick = function () {
    const visible = filteredItems();

    if (!visible.length) {
      CM.toast("내보낼 훈련 계획이 없습니다.");
      return;
    }

    CM.exportTrainingCSV(visible);
  };

  $("tr-list").onclick = safe(async function (event) {
    const button = event.target.closest(
      "button[data-training-action]"
    );

    if (!button || mutationBusy) return;

    const id = button.dataset.trainingId;
    const action = button.dataset.trainingAction;

    const item = items.find(entry => entry.id === id);

    if (!item) return;

    if (action === "edit") {
      await CM.openTrainingForm(
        item,
        null,
        CM.renderTraining
      );

      return;
    }

    if (action === "report") {
      const record = await CM.db.get(
        "records",
        item.sourceRecordId
      );

      if (!record) {
        CM.toast("연결된 리포트가 삭제되었거나 존재하지 않습니다.");
        return;
      }

      CM.selectedRecord = record.id;
      CM.selectedAthlete = record.athleteId || "";

      location.hash = "reports";

      return;
    }

    if (action === "analyze") {
      const exercise = CM.exercises.find(entry => {
        return entry.id === item.exerciseId;
      });

      if (!exercise) {
        CM.toast("해당 운동을 찾지 못했습니다. 운동 목록을 확인하세요.");
        return;
      }

      const athlete = item.athleteId
        ? await CM.db.get("athletes", item.athleteId)
        : null;

      CM.selectedAthlete = athlete?.id || "";
      CM.selectedExercise = exercise.id;

      await CM.rememberExercise(exercise.id);

      location.hash = "analysis";

      return;
    }

    if (action === "delete") {
      const accepted = window.confirm(
        CM.trainingExerciseName(item) +
        " 훈련 계획을 삭제할까요?\n" +
        "연결된 분석 리포트는 유지됩니다."
      );

      if (!accepted) return;
    }

    mutationBusy = true;
    button.disabled = true;

    try {
      if (action === "toggle") {
        const latest = await CM.db.get("training", id);

        if (!latest) {
          throw new Error("이 훈련 계획은 이미 삭제되었습니다.");
        }

        const done = !latest.done;
        const now = new Date().toISOString();

        await CM.db.put("training", {
          ...latest,
          done,
          doneAt: done ? now : null,
          updatedAt: now
        });

        CM.toast(
          done
            ? "훈련 완료를 기록했습니다."
            : "완료 표시를 취소했습니다."
        );
      }

      if (action === "delete") {
        await CM.db.remove("training", id);
        CM.toast("훈련 계획을 삭제했습니다.");
      }

      await reloadItems();
    } finally {
      mutationBusy = false;
      button.disabled = false;
    }
  });

  if (
    CM.selectedAthlete &&
    athleteMap.has(CM.selectedAthlete)
  ) {
    $("tr-athlete").value = CM.selectedAthlete;
  }

  draw();
};