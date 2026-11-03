/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   athletes.js

   선수등록 / 사진 / 검색 / 정보 수정 / 선수 삭제
   선수별 분석 기록 / 추가 훈련 연결

   선수 프로필 삭제 시 기존 분석 기록은 유지됩니다.
   ========================================================= */

"use strict";

window.CM = window.CM || {};

CM.selectedAthlete = CM.selectedAthlete || "";

/* ---------------------------------------------------------
   선수 공통 도구
   --------------------------------------------------------- */

CM.athleteName = function (athlete) {
  return athlete?.name || "임시 분석";
};

CM.athleteAvatar = function (athlete, large = false) {
  const className = large
    ? "portrait profile-photo"
    : "portrait";

  const photo = athlete?.photo;

  const validPhoto =
    typeof photo === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,/i.test(photo);

  if (validPhoto) {
    return `
      <img
        class="${className}"
        src="${CM.escape(photo)}"
        alt="${CM.escape(athlete.name)} 프로필"
      >
    `;
  }

  const initial = Array.from(
    String(athlete?.name || "선")
  )[0];

  return `
    <span class="${className}" aria-hidden="true">
      ${CM.escape(initial)}
    </span>
  `;
};

CM.athleteOptions = async function (
  selectedId = CM.selectedAthlete,
  includeGuest = true
) {
  const athletes = await CM.db.all("athletes");

  athletes.sort((a, b) => {
    return a.name.localeCompare(b.name, "ko");
  });

  let html = includeGuest
    ? `<option value="">임시 분석 · 선수 미지정</option>`
    : "";

  html += athletes.map(athlete => {
    return `
      <option
        value="${CM.escape(athlete.id)}"
        ${athlete.id === selectedId ? "selected" : ""}
      >
        ${CM.escape(athlete.name)}
        ${athlete.team ? " · " + CM.escape(athlete.team) : ""}
      </option>
    `;
  }).join("");

  return html;
};

/* ---------------------------------------------------------
   프로필 사진 변환
   - JPEG / PNG / WebP
   - 최대 입력 10MB
   - 긴 변 360px로 축소
   --------------------------------------------------------- */

CM.prepareAthletePhoto = async function (file) {
  if (!file) return "";

  const acceptedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
  ];

  if (!acceptedTypes.includes(file.type)) {
    throw new Error(
      "프로필 사진은 JPG·PNG·WebP 파일로 선택해 주세요."
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error(
      "프로필 사진은 10MB 이하로 선택해 주세요."
    );
  }

  const url = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();

      element.onload = () => resolve(element);

      element.onerror = () => {
        reject(new Error("사진을 읽지 못했습니다."));
      };

      element.src = url;
    });

    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("올바른 이미지가 아닙니다.");
    }

    const ratio = Math.min(
      1,
      360 / Math.max(
        image.naturalWidth,
        image.naturalHeight
      )
    );

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(
      1,
      Math.round(image.naturalWidth * ratio)
    );

    canvas.height = Math.max(
      1,
      Math.round(image.naturalHeight * ratio)
    );

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("사진 변환을 지원하지 않는 환경입니다.");
    }

    context.fillStyle = "#102b3b";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/* ---------------------------------------------------------
   등록 / 수정 창
   --------------------------------------------------------- */

CM.openAthleteForm = function (
  athlete = null,
  onSaved = null
) {
  const editing = Boolean(athlete);

  const current = athlete || {
    name: "",
    team: "",
    sport: "",
    height: null,
    weight: null,
    memo: "",
    photo: ""
  };

  CM.modal(
    `
      <h2>${editing ? "선수 정보 수정" : "선수등록"}</h2>

      <form id="athlete-form" class="stack">
        <div class="row">
          <div id="athlete-photo-preview">
            ${CM.athleteAvatar(current, true)}
          </div>

          <div style="flex:1">
            <label>
              프로필 사진 · 선택
              <input
                id="athlete-photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
              >
            </label>

            <button
              id="athlete-photo-remove"
              type="button"
              class="small"
              style="margin-top:8px"
            >
              사진 제거
            </button>

            <p
              id="athlete-photo-status"
              class="notice"
              role="status"
            ></p>
          </div>
        </div>

        <div class="form-grid">
          <label>
            선수 이름 *
            <input
              name="name"
              required
              maxlength="40"
              autocomplete="off"
              value="${CM.escape(current.name)}"
            >
          </label>

          <label>
            소속
            <input
              name="team"
              maxlength="80"
              value="${CM.escape(current.team)}"
              placeholder="학교 또는 팀"
            >
          </label>

          <label>
            종목
            <input
              name="sport"
              maxlength="60"
              value="${CM.escape(current.sport)}"
              placeholder="바이애슬론, 육상 등"
            >
          </label>

          <label>
            키 · cm · 선택
            <input
              name="height"
              type="number"
              min="30"
              max="300"
              step="0.1"
              inputmode="decimal"
              value="${CM.escape(current.height ?? "")}"
            >
          </label>

          <label>
            체중 · kg · 선택
            <input
              name="weight"
              type="number"
              min="1"
              max="500"
              step="0.1"
              inputmode="decimal"
              value="${CM.escape(current.weight ?? "")}"
            >
          </label>
        </div>

        <label>
          선수 메모
          <textarea
            name="memo"
            maxlength="3000"
            placeholder="분석 목적이나 참고 사항"
          >${CM.escape(current.memo)}</textarea>
        </label>

        <p class="notice">
          입력한 정보와 사진은 현재 브라우저에 저장됩니다.
        </p>

        <button
          id="athlete-save"
          type="submit"
          class="primary"
        >
          ${editing ? "변경 내용 저장" : "선수등록"}
        </button>
      </form>
    `,

    function () {
      const form = document.querySelector("#athlete-form");
      const photoInput = document.querySelector("#athlete-photo");
      const photoPreview = document.querySelector(
        "#athlete-photo-preview"
      );

      const photoStatus = document.querySelector(
        "#athlete-photo-status"
      );

      const saveButton = document.querySelector(
        "#athlete-save"
      );

      const removePhotoButton = document.querySelector(
        "#athlete-photo-remove"
      );

      const modalClose = document.querySelector("#modal-close");
      const dialog = document.querySelector("#modal");

      let photo = current.photo || "";
      let processingPhoto = false;
      let saving = false;

      function refreshPhoto() {
        photoPreview.innerHTML = CM.athleteAvatar(
          {
            name: form.elements.name.value || "선수",
            photo
          },
          true
        );
      }

      form.elements.name.addEventListener(
        "input",
        refreshPhoto
      );

      photoInput.onchange = async function () {
        const file = photoInput.files?.[0];

        if (!file) return;

        processingPhoto = true;
        saveButton.disabled = true;
        photoInput.disabled = true;
        removePhotoButton.disabled = true;

        photoStatus.textContent = "사진을 준비하고 있습니다.";

        try {
          photo = await CM.prepareAthletePhoto(file);

          refreshPhoto();

          photoStatus.textContent =
            "사진 준비 완료. 저장 버튼을 눌러 반영하세요.";
        } catch (error) {
          photoStatus.textContent = error.message;

          CM.toast(error.message);
        } finally {
          processingPhoto = false;

          saveButton.disabled = false;
          photoInput.disabled = false;
          removePhotoButton.disabled = false;

          photoInput.value = "";
        }
      };

      removePhotoButton.onclick = function () {
        if (processingPhoto || saving) return;

        photo = "";
        photoInput.value = "";
        photoStatus.textContent =
          "저장하면 프로필 사진이 제거됩니다.";

        refreshPhoto();
      };

      function preventCancelWhileSaving(event) {
        if (saving) {
          event.preventDefault();
        }
      }

      dialog.addEventListener(
        "cancel",
        preventCancelWhileSaving
      );

      dialog.addEventListener(
        "close",
        function () {
          dialog.removeEventListener(
            "cancel",
            preventCancelWhileSaving
          );
        },
        { once: true }
      );

      form.onsubmit = async function (event) {
        event.preventDefault();

        if (processingPhoto || saving) return;

        if (!form.reportValidity()) return;

        const values = new FormData(form);
        const name = String(values.get("name") || "").trim();

        if (!name) {
          CM.toast("선수 이름을 입력해 주세요.");
          return;
        }

        function optionalNumber(key) {
          const value = String(values.get(key) || "").trim();

          return value === "" ? null : Number(value);
        }

        const now = new Date().toISOString();

        const updated = {
          ...current,

          id: athlete?.id || CM.uid(),

          name,

          team: String(values.get("team") || "").trim(),
          sport: String(values.get("sport") || "").trim(),

          height: optionalNumber("height"),
          weight: optionalNumber("weight"),

          memo: String(values.get("memo") || "").trim(),
          photo,

          createdAt: athlete?.createdAt || now,
          updatedAt: now
        };

        saving = true;
        saveButton.disabled = true;
        modalClose.disabled = true;

        try {
          await CM.db.put("athletes", updated);
        } catch (error) {
          CM.toast(
            error.message || "선수 정보를 저장하지 못했습니다."
          );

          return;
        } finally {
          saving = false;
          saveButton.disabled = false;
          modalClose.disabled = false;
        }

        CM.selectedAthlete = updated.id;

        dialog.close();

        CM.toast(
          editing
            ? "선수 정보를 수정했습니다."
            : "선수를 등록했습니다."
        );

        if (typeof onSaved === "function") {
          try {
            await onSaved(updated);
          } catch (error) {
            CM.toast(
              "저장은 완료했지만 화면 갱신에 실패했습니다. 새로고침해 주세요."
            );
          }
        }
      };
    }
  );
};

/* ---------------------------------------------------------
   선수 프로필 삭제
   분석 기록 / 훈련 기록은 자동 삭제하지 않습니다.
   --------------------------------------------------------- */

CM.deleteAthlete = async function (athlete) {
  const records = await CM.db.all("records");
  const training = await CM.db.all("training");

  const recordCount = records.filter(record => {
    return record.athleteId === athlete.id;
  }).length;

  const trainingCount = training.filter(item => {
    return item.athleteId === athlete.id;
  }).length;

  const accepted = window.confirm(
    athlete.name + " 선수의 프로필을 삭제할까요?\n\n" +
    "연결된 분석 기록: " + recordCount + "개\n" +
    "연결된 훈련 기록: " + trainingCount + "개\n\n" +
    "기존 분석·훈련 기록은 유지됩니다.\n" +
    "기록에 저장된 이름과 영상은 별도로 삭제해야 합니다."
  );

  if (!accepted) return false;

  await CM.db.remove("athletes", athlete.id);

  if (CM.selectedAthlete === athlete.id) {
    CM.selectedAthlete = "";
  }

  CM.toast("선수 프로필을 삭제했습니다.");

  return true;
};

/* ---------------------------------------------------------
   날짜 표시
   --------------------------------------------------------- */

CM.athleteRecordDate = function (record) {
  const date = new Date(
    record.createdAt || record.date || ""
  );

  if (!Number.isFinite(date.getTime())) {
    return "날짜 없음";
  }

  return date.toLocaleDateString("ko-KR");
};

CM.athleteRecordExercise = function (record) {
  if (record.exercise?.name) {
    return record.exercise.name;
  }

  const id =
    typeof record.exercise === "string"
      ? record.exercise
      : record.exerciseId;

  const matched = CM.exercises?.find(exercise => {
    return exercise.id === id;
  });

  return matched?.name || "운동 기록";
};

/* ---------------------------------------------------------
   선수 관리 화면
   --------------------------------------------------------- */

CM.renderAthletes = async function () {
  const [athletes, records, training] = await Promise.all([
    CM.db.all("athletes"),
    CM.db.all("records"),
    CM.db.all("training")
  ]);

  athletes.sort((a, b) => {
    return a.name.localeCompare(b.name, "ko");
  });

  let selectedId = athletes.some(athlete => {
    return athlete.id === CM.selectedAthlete;
  })
    ? CM.selectedAthlete
    : athletes[0]?.id || "";

  const main = document.querySelector("#main");

  main.innerHTML =
    CM.heading(
      "선수 관리",
      "ATHLETE MANAGEMENT",
      `
        <button
          id="athlete-add"
          type="button"
          class="primary"
        >
          + 선수등록
        </button>
      `
    ) +
    `
      <div class="grid g2">
        <section class="panel">
          <div class="row spread">
            <h2>등록 선수</h2>

            <span class="badge">
              ${athletes.length}명
            </span>
          </div>

          <input
            id="athlete-search"
            type="search"
            placeholder="이름·소속·종목 검색"
            aria-label="선수 검색"
          >

          <div
            id="athlete-list"
            class="stack"
            style="margin-top:16px"
          ></div>
        </section>

        <section
          id="athlete-detail"
          class="panel"
          aria-label="선수 상세 정보"
        ></section>
      </div>
    `;

  const search = document.querySelector("#athlete-search");
  const list = document.querySelector("#athlete-list");
  const detail = document.querySelector("#athlete-detail");

  function drawList() {
    const query = search.value
      .trim()
      .toLocaleLowerCase("ko");

    const filtered = athletes.filter(athlete => {
      const text = [
        athlete.name,
        athlete.team,
        athlete.sport
      ].join(" ").toLocaleLowerCase("ko");

      return text.includes(query);
    });

    if (!filtered.length) {
      list.innerHTML = CM.empty(
        athletes.length
          ? "검색 결과가 없습니다."
          : "첫 선수를 등록해 주세요."
      );

      return;
    }

    list.innerHTML = filtered.map(athlete => {
      const count = records.filter(record => {
        return record.athleteId === athlete.id;
      }).length;

      return `
        <button
          type="button"
          data-athlete-id="${CM.escape(athlete.id)}"
          class="row spread"
          aria-pressed="${athlete.id === selectedId}"
          style="
            width:100%;
            text-align:left;
            ${
              athlete.id === selectedId
                ? "border-color:var(--accent);background:#123342"
                : ""
            }
          "
        >
          <span class="row">
            ${CM.athleteAvatar(athlete)}

            <span>
              <strong>${CM.escape(athlete.name)}</strong>

              <small style="display:block">
                ${CM.escape(athlete.team || "소속 미입력")}
                ·
                ${CM.escape(athlete.sport || "종목 미입력")}
              </small>
            </span>
          </span>

          <span class="badge">
            분석 ${count}개
          </span>
        </button>
      `;
    }).join("");
  }

  function drawDetail() {
    const athlete = athletes.find(item => {
      return item.id === selectedId;
    });

    if (!athlete) {
      detail.innerHTML = CM.empty(
        "선수를 선택하거나 새로 등록해 주세요."
      );

      return;
    }

    const athleteRecords = records
      .filter(record => record.athleteId === athlete.id)
      .sort((a, b) => {
        const first = Date.parse(a.createdAt || a.date || "") || 0;
        const second = Date.parse(b.createdAt || b.date || "") || 0;

        return second - first;
      });

    const athleteTraining = training.filter(item => {
      return item.athleteId === athlete.id;
    });

    const completedTraining = athleteTraining.filter(item => {
      return item.done === true;
    }).length;

    detail.innerHTML = `
      <div class="row">
        ${CM.athleteAvatar(athlete, true)}

        <div>
          <h2 style="margin-bottom:5px">
            ${CM.escape(athlete.name)}
          </h2>

          <p class="muted">
            ${CM.escape(athlete.team || "소속 미입력")}
            ·
            ${CM.escape(athlete.sport || "종목 미입력")}
          </p>

          <small>
            키 ${CM.fmt(athlete.height)} cm
            ·
            체중 ${CM.fmt(athlete.weight)} kg
          </small>
        </div>
      </div>

      <div class="row" style="margin-top:18px">
        <button
          id="athlete-start"
          type="button"
          class="primary"
        >
          자세분석 시작
        </button>

        <button id="athlete-edit" type="button">
          정보 수정
        </button>

        <button
          id="athlete-delete"
          type="button"
          class="danger"
        >
          프로필 삭제
        </button>
      </div>

      <div class="grid g3" style="margin-top:20px">
        <div>
          <small>분석 기록</small>
          <div class="metric">${athleteRecords.length}</div>
        </div>

        <div>
          <small>등록 훈련</small>
          <div class="metric">${athleteTraining.length}</div>
        </div>

        <div>
          <small>완료 훈련</small>
          <div class="metric">${completedTraining}</div>
        </div>
      </div>

      <details style="margin-top:20px">
        <summary>선수 메모</summary>

        <p style="white-space:pre-wrap">${CM.escape(
          athlete.memo || "등록된 메모가 없습니다."
        )}</p>
      </details>

      <h3 style="margin-top:24px">최근 분석 기록</h3>

      ${
        athleteRecords.length
          ? `
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">날짜</th>
                    <th scope="col">운동</th>
                    <th scope="col">리포트</th>
                  </tr>
                </thead>

                <tbody>
                  ${athleteRecords.slice(0, 8).map(record => {
                    return `
                      <tr>
                        <td>
                          ${CM.athleteRecordDate(record)}
                        </td>

                        <td>
                          ${CM.escape(
                            CM.athleteRecordExercise(record)
                          )}
                        </td>

                        <td>
                          <button
                            type="button"
                            class="small"
                            data-report-id="${CM.escape(record.id)}"
                          >
                            열기
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
          `
          : CM.empty("아직 분석 기록이 없습니다.")
      }

      <div class="row" style="margin-top:18px">
        <button id="athlete-reports" type="button">
          전체 리포트
        </button>

        <button id="athlete-training" type="button">
          추가 훈련 보기
        </button>
      </div>
    `;

    document.querySelector("#athlete-start").onclick =
      function () {
        CM.selectedAthlete = athlete.id;
        location.hash = "analysis";
      };

    document.querySelector("#athlete-edit").onclick =
      function () {
        CM.openAthleteForm(
          athlete,
          CM.renderAthletes
        );
      };

    document.querySelector("#athlete-delete").onclick =
      async function (event) {
        const button = event.currentTarget;
        button.disabled = true;

        try {
          const removed = await CM.deleteAthlete(athlete);

          if (removed) {
            await CM.renderAthletes();
          }
        } catch (error) {
          CM.toast(
            error.message || "프로필 삭제에 실패했습니다."
          );
        } finally {
          button.disabled = false;
        }
      };

    document.querySelector("#athlete-reports").onclick =
      function () {
        CM.selectedAthlete = athlete.id;
        CM.selectedRecord = null;

        location.hash = "reports";
      };

    document.querySelector("#athlete-training").onclick =
      function () {
        CM.selectedAthlete = athlete.id;

        location.hash = "training";
      };

    detail.querySelectorAll(
      "button[data-report-id]"
    ).forEach(button => {
      button.onclick = function () {
        CM.selectedAthlete = athlete.id;
        CM.selectedRecord = button.dataset.reportId;

        location.hash = "reports";
      };
    });
  }

  document.querySelector("#athlete-add").onclick =
    function () {
      CM.openAthleteForm(
        null,
        CM.renderAthletes
      );
    };

  search.oninput = drawList;

  list.onclick = function (event) {
    const button = event.target.closest(
      "button[data-athlete-id]"
    );

    if (!button) return;

    selectedId = button.dataset.athleteId;
    CM.selectedAthlete = selectedId;

    drawList();
    drawDetail();
  };

  drawList();
  drawDetail();
};