/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   reports.js

   분석 기록 검색 / 상세 리포트
   관절·좌우·반복·정렬·궤적·측정 상태
   주요 장면 / 이전 기록 추세
   코치 피드백 / 보완점 / 다음 목표
   육각형 코치 평가 / PDF 인쇄 / CSV

   육각형은 코치가 입력한 평가입니다.
   영상 각도를 임의의 자세 점수로 바꾸지 않습니다.
   ========================================================= */

"use strict";

window.CM = window.CM || {};

CM.reportAxes = [
  "목표 범위",
  "좌우 움직임",
  "몸통 제어",
  "반복 일관성",
  "템포 수행",
  "목표 수행"
];

CM.reportViewNames = {
  side: "측면",
  front: "정면",
  back: "후면"
};

/* ---------------------------------------------------------
   공통 데이터 처리
   --------------------------------------------------------- */

CM.recordSamples = function (record) {
  return (record?.samples || [])
    .filter(sample => Number.isFinite(sample.t))
    .slice()
    .sort((a, b) => a.t - b.t);
};

CM.reportRecordLabel = function (record) {
  return [
    record.athleteName || "임시 분석",
    CM.athleteRecordExercise(record),
    CM.athleteRecordDate(record)
  ].join(" · ");
};

CM.reportCompatible = function (a, b) {
  if (!a || !b || a.id === b.id) return false;

  return (
    a.athleteId === b.athleteId &&
    (a.exerciseId || a.exercise?.id) ===
      (b.exerciseId || b.exercise?.id) &&
    a.view === b.view &&
    a.measurementVersion === b.measurementVersion &&
    a.angleDefinition === b.angleDefinition
  );
};

CM.csvCell = function (value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  let text = String(value);

  // 스프레드시트에서 문자열이 수식으로 실행되지 않게 합니다.
  if (/^[\s]*[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return '"' + text.replace(/"/g, '""') + '"';
};

CM.exportRecordCSV = function (record) {
  const angleKeys = Object.keys(CM.poseJoints)
    .flatMap(joint => [
      "left_" + joint,
      "right_" + joint
    ]);

  const metricKeys = [
    "left_trunk",
    "right_trunk",
    "shoulderTilt",
    "hipTilt",
    "pelvisX",
    "pelvisY",
    "left_kneeToe",
    "right_kneeToe"
  ];

  const header = [
    "time_seconds",
    ...angleKeys.map(key => key + "_degrees"),
    ...metricKeys,
    "manual",
    "bar_x_normalized",
    "bar_y_normalized"
  ];

  const rows = CM.recordSamples(record).map(sample => {
    return [
      sample.t,
      ...angleKeys.map(key => sample.angles?.[key]),
      ...metricKeys.map(key => sample.metrics?.[key]),
      sample.manual ? "yes" : "no",
      sample.bar?.x,
      sample.bar?.y
    ];
  });

  const csv = [
    header,
    ...rows
  ].map(row => row.map(CM.csvCell).join(",")).join("\r\n");

  CM.download(
    "codeon-measurements.csv",
    "\uFEFF" + csv,
    "text/csv;charset=utf-8"
  );
};

/* ---------------------------------------------------------
   측정값에 근거한 자동 설명
   원인·부상·근력 부족은 추정하지 않습니다.
   --------------------------------------------------------- */

CM.reportObservations = function (samples, joint) {
  const name = CM.poseJoints[joint].name;

  const left = CM.stats(
    samples.map(sample => sample.angles?.["left_" + joint])
  );

  const right = CM.stats(
    samples.map(sample => sample.angles?.["right_" + joint])
  );

  const differences = [];

  for (const sample of samples) {
    const a = sample.angles?.["left_" + joint];
    const b = sample.angles?.["right_" + joint];

    if (Number.isFinite(a) && Number.isFinite(b)) {
      differences.push({
        time: sample.t,
        value: Math.abs(a - b)
      });
    }
  }

  const messages = [];

  if (left.n) {
    messages.push({
      text:
        "왼쪽 " + name + " 내부각은 " +
        CM.fmt(left.min) + "°~" +
        CM.fmt(left.max) + "° 범위로 관찰되었습니다.",
      time: null
    });
  }

  if (right.n) {
    messages.push({
      text:
        "오른쪽 " + name + " 내부각은 " +
        CM.fmt(right.min) + "°~" +
        CM.fmt(right.max) + "° 범위로 관찰되었습니다.",
      time: null
    });
  }

  if (differences.length) {
    const largest = differences.reduce((best, item) => {
      return item.value > best.value ? item : best;
    });

    messages.push({
      text:
        "측정된 좌우 각도 차이는 " +
        CM.fmt(largest.time) + "초에서 가장 컸으며 " +
        CM.fmt(largest.value) + "°였습니다. " +
        "촬영 방향과 관절 인식 상태를 함께 확인하세요.",
      time: largest.time
    });
  }

  const validCount = samples.filter(sample => {
    return (
      Number.isFinite(sample.angles?.["left_" + joint]) ||
      Number.isFinite(sample.angles?.["right_" + joint])
    );
  }).length;

  if (samples.length) {
    messages.push({
      text:
        "저장된 " + samples.length + "개 표본 중 " +
        validCount + "개에서 선택 관절의 한쪽 이상을 측정했습니다.",
      time: null
    });
  }

  if (!left.n && !right.n) {
    messages.unshift({
      text:
        "선택한 관절의 유효한 측정값이 없습니다. " +
        "촬영 방향이나 가림을 확인하세요.",
      time: null
    });
  }

  return messages;
};

/* ---------------------------------------------------------
   리포트 화면
   --------------------------------------------------------- */

CM.renderReports = async function () {
  let records = await CM.db.all("records");

  records.sort((a, b) => {
    return (
      (Date.parse(b.createdAt) || 0) -
      (Date.parse(a.createdAt) || 0)
    );
  });

  const main = document.querySelector("#main");

  if (!records.length) {
    main.innerHTML =
      CM.heading("분석 리포트", "PERFORMANCE REPORT") +
      `
        <section class="panel">
          ${CM.empty("저장된 분석 기록이 없습니다.")}
          <a href="#analysis">자세분석 시작 →</a>
        </section>
      `;

    return;
  }

  const state = {
    active: true,
    dirty: false,
    saving: false,
    record: null,
    joint: "knee",
    side: "both",
    start: 0,
    end: 0
  };

  let unbindChart = null;

  const chosen =
    records.find(record => record.id === CM.selectedRecord) ||
    records.find(record => record.athleteId === CM.selectedAthlete) ||
    records[0];

  main.innerHTML =
    CM.heading(
      "분석 리포트",
      "PERFORMANCE REPORT",
      `<span class="badge">실버스타 스포츠 과학원</span>`
    ) +
    `
      <section class="panel no-print">
        <div class="row">
          <input
            id="rp-search"
            type="search"
            placeholder="선수·운동 검색"
            aria-label="리포트 검색"
            style="flex:1;min-width:160px"
          >

          <select
            id="rp-record"
            aria-label="분석 기록"
            style="flex:2;min-width:220px"
          ></select>
        </div>

        <div class="row" style="margin-top:14px">
          <button id="rp-print" class="primary">
            인쇄 / PDF
          </button>

          <button id="rp-csv">
            전체 측정값 CSV
          </button>

          <button id="rp-compare">
            이전 기록 비교
          </button>

          <button id="rp-training">
            추가 훈련 작성
          </button>

          <button id="rp-delete" class="danger">
            기록 삭제
          </button>
        </div>
      </section>

      <div id="rp-content"></div>
    `;

  const $ = id => document.getElementById(id);

  function options() {
    const query = $("rp-search").value
      .trim()
      .toLocaleLowerCase("ko");

    const filtered = records.filter(record => {
      return (
        record.id === state.record?.id ||
        CM.reportRecordLabel(record)
          .toLocaleLowerCase("ko")
          .includes(query)
      );
    });

    $("rp-record").innerHTML = filtered.map(record => `
      <option value="${CM.escape(record.id)}">
        ${CM.escape(CM.reportRecordLabel(record))}
      </option>
    `).join("");

    if (state.record) {
      $("rp-record").value = state.record.id;
    }
  }

  function selectedSides() {
    return state.side === "both"
      ? ["left", "right"]
      : [state.side];
  }

  function selectedSamples() {
    return CM.recordSamples(state.record).filter(sample => {
      return sample.t >= state.start && sample.t <= state.end;
    });
  }

  function previousRecord() {
    const currentDate =
      Date.parse(state.record.createdAt) || 0;

    return records.find(record => {
      return (
        CM.reportCompatible(state.record, record) &&
        (Date.parse(record.createdAt) || 0) < currentDate
      );
    }) || null;
  }

  function section(id, title, contents) {
    return `
      <section
        id="rp-section-${id}"
        class="panel report-section"
      >
        <div class="row spread">
          <h2>${title}</h2>

          <label class="no-print">
            <input
              type="checkbox"
              data-print-section="${id}"
              checked
            >
            출력 포함
          </label>
        </div>

        ${contents}
      </section>
    `;
  }

  function angleSeries(samples) {
    return selectedSides().map((side, index) => ({
      name:
        (side === "left" ? "왼쪽 " : "오른쪽 ") +
        CM.poseJoints[state.joint].name,

      color: CM.colors[index],
      dash: side === "right",

      data: samples.map(sample => ({
        x: sample.t,
        y: sample.angles?.[side + "_" + state.joint] ?? null
      }))
    }));
  }

  function statTable(samples) {
    const rows = [];

    for (const [joint, definition] of Object.entries(
      CM.poseJoints
    )) {
      for (const side of selectedSides()) {
        const stats = CM.stats(
          samples.map(sample => {
            return sample.angles?.[side + "_" + joint];
          })
        );

        rows.push(`
          <tr>
            <td>
              ${side === "left" ? "왼쪽" : "오른쪽"}
              ${definition.name}
            </td>

            <td>${CM.fmt(stats.min)}°</td>
            <td>${CM.fmt(stats.max)}°</td>
            <td>${CM.fmt(stats.mean)}°</td>
            <td>${CM.fmt(stats.range)}°</td>
            <td>${stats.n}</td>
          </tr>
        `);
      }
    }

    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>관절</th>
              <th>최소</th>
              <th>최대</th>
              <th>평균</th>
              <th>변화 범위</th>
              <th>유효 표본</th>
            </tr>
          </thead>

          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
    `;
  }

  function repData() {
    const samples = selectedSamples();

    return (state.record.repetitions || [])
      .filter(rep => {
        return (
          Number.isFinite(rep.start) &&
          Number.isFinite(rep.end) &&
          rep.end > rep.start &&
          rep.start >= state.start &&
          rep.end <= state.end
        );
      })
      .map((rep, index) => {
        const sectionSamples = samples.filter(sample => {
          return sample.t >= rep.start && sample.t <= rep.end;
        });

        return {
          ...rep,
          number: index + 1,
          samples: sectionSamples
        };
      });
  }

  function repsHTML() {
    const reps = repData();

    if (!reps.length) {
      return CM.chartEmpty(
        "선택 구간 안에 완전히 포함된 반복 기록이 없습니다."
      );
    }

    const side = selectedSides()[0];
    const key = side + "_" + state.joint;

    const table = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>반복</th>
              <th>시작</th>
              <th>종료</th>
              <th>시간</th>
              <th>최소각</th>
              <th>최대각</th>
              <th>기록 방식</th>
            </tr>
          </thead>

          <tbody>
            ${reps.map(rep => {
              const stats = CM.stats(
                rep.samples.map(sample => sample.angles?.[key])
              );

              return `
                <tr>
                  <td>${rep.number}회</td>
                  <td>${CM.fmt(rep.start)}초</td>
                  <td>${CM.fmt(rep.end)}초</td>
                  <td>${CM.fmt(rep.end - rep.start)}초</td>
                  <td>${CM.fmt(stats.min)}°</td>
                  <td>${CM.fmt(stats.max)}°</td>
                  <td>
                    ${rep.source === "manual" ? "수동" : "자동·확인 필요"}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;

    const series = reps.slice(0, 12).map((rep, index) => {
      const duration = rep.end - rep.start;

      // 긴 누락을 0~100% 좌표에서도 유지합니다.
      const data = [];
      let lastTime = null;

      for (const sample of rep.samples) {
        const x = (sample.t - rep.start) / duration * 100;

        if (lastTime !== null && sample.t - lastTime > 0.8) {
          data.push({ x, y: null });
        }

        data.push({
          x,
          y: sample.angles?.[key] ?? null
        });

        lastTime = sample.t;
      }

      return {
        name: rep.number + "회",
        color: CM.colors[index % CM.colors.length],
        data
      };
    });

    return `
      <p class="notice">
        ${side === "left" ? "왼쪽" : "오른쪽"}
        ${CM.poseJoints[state.joint].name} 기준.
        전체 반복을 표시 선택과 무관하게 삭제하지 않습니다.
      </p>

      ${CM.barChart(
        reps.map(rep => ({
          label: rep.number + "회",
          value: rep.end - rep.start
        })),
        "초"
      )}

      ${table}

      <h3 style="margin-top:22px">반복 동작 패턴</h3>

      ${CM.lineChart(series, {
        min: 0,
        max: 180,
        xMin: 0,
        xMax: 100,
        xUnit: "%",
        maxGap: Infinity,
        title: "반복 진행률별 관절 각도"
      })}

      <p class="notice">
        반복 시작과 끝을 0~100%로 맞춘 비교입니다.
        최대 12개 반복을 겹쳐 표시합니다.
      </p>
    `;
  }

  function alignmentHTML(samples) {
    const metricDefinitions = [
      ["left_trunk", "왼쪽 몸통 기울기"],
      ["right_trunk", "오른쪽 몸통 기울기"],
      ["shoulderTilt", "어깨선 기울기"],
      ["hipTilt", "골반선 기울기"]
    ];

    const series = metricDefinitions.map(([key, name], index) => ({
      name,
      color: CM.colors[index],

      data: samples.map(sample => ({
        x: sample.t,
        y: sample.metrics?.[key] ?? null
      }))
    }));

    const side = selectedSides()[0];
    const pointId = CM.poseJoints[state.joint][side][1];

    const path = [];

    let previousTime = null;

    for (const sample of samples) {
      if (
        previousTime !== null &&
        sample.t - previousTime > 0.8
      ) {
        path.push(null);
      }

      const point = sample.points?.[pointId];

      path.push(
        CM.posePointValid(point)
          ? {
              x: point.x * (state.record.width || 1280),
              y: point.y * (state.record.height || 720)
            }
          : null
      );

      previousTime = sample.t;
    }

    return `
      ${CM.lineChart(series, { unit: "°" })}

      <p class="notice">
        몸통은 영상 수직선 기준입니다.
        어깨·골반선은 영상 수평선 기준이며 카메라 기울기의 영향을 받습니다.
      </p>

      <h3 style="margin-top:22px">
        ${side === "left" ? "왼쪽" : "오른쪽"}
        ${CM.poseJoints[state.joint].name} 이동 궤적
      </h3>

      ${CM.trajectoryChart(path)}

      <h3 style="margin-top:22px">바벨 수동 표시 궤적</h3>

      ${CM.trajectoryChart(
        samples.map(sample => {
          return sample.bar
            ? {
                x: sample.bar.x * (state.record.width || 1280),
                y: sample.bar.y * (state.record.height || 720)
              }
            : null;
        })
      )}

      <p class="notice">
        바벨 위치는 사용자가 표시한 값입니다.
        영상에 기록되지 않은 힘·압력·속도를 추정하지 않습니다.
      </p>
    `;
  }

  function qualityHTML(samples) {
    const items = [];

    for (const side of selectedSides()) {
      for (const [joint, definition] of Object.entries(
        CM.poseJoints
      )) {
        const valid = samples.filter(sample => {
          return Number.isFinite(
            sample.angles?.[side + "_" + joint]
          );
        }).length;

        items.push({
          label:
            (side === "left" ? "L " : "R ") +
            definition.name,

          value: samples.length
            ? valid / samples.length * 100
            : null
        });
      }
    }

    const gaps = [];

    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];

      if (current.t - previous.t > 0.8) {
        gaps.push({
          label: "미기록 " + (gaps.length + 1),
          start: previous.t,
          end: current.t
        });
      }
    }

    const manual = samples.filter(sample => sample.manual).length;

    return `
      ${CM.barChart(items, "%")}

      <p>
        저장 표본 ${samples.length}개
        · 수동 보정 표본 ${manual}개
      </p>

      <p class="notice">
        비율은 저장된 표본 중 해당 각도가 계산된 비율입니다.
        정확도나 전체 영상의 분석 완료율을 의미하지 않습니다.
      </p>

      <h3 style="margin-top:20px">0.8초 초과 표본 간격</h3>

      ${
        gaps.length
          ? CM.timeline(gaps)
          : '<p class="muted">선택 구간의 표본 사이에 긴 간격이 없습니다.</p>'
      }
    `;
  }

  function historyHTML() {
    const current = state.record;

    const comparable = records
      .filter(record => {
        return (
          record.id === current.id ||
          CM.reportCompatible(current, record)
        );
      })
      .sort((a, b) => {
        return (
          (Date.parse(a.createdAt) || 0) -
          (Date.parse(b.createdAt) || 0)
        );
      });

    const side = selectedSides()[0];
    const key = side + "_" + state.joint;

    const items = comparable.map(record => ({
      label: CM.athleteRecordDate(record),

      value: CM.stats(
        CM.recordSamples(record).map(sample => {
          return sample.angles?.[key];
        })
      ).range
    }));

    return `
      <p class="notice">
        같은 선수·운동·촬영 방향·측정 버전의 전체 기록을 비교합니다.
        카메라 위치와 운동 중량은 별도로 확인하세요.
      </p>

      <h3>
        ${side === "left" ? "왼쪽" : "오른쪽"}
        ${CM.poseJoints[state.joint].name} 각도 변화 범위
      </h3>

      ${CM.barChart(items, "°")}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>중량</th>
              <th>반복 기록</th>
              <th>메모</th>
            </tr>
          </thead>

          <tbody>
            ${comparable.map(record => `
              <tr>
                <td>${CM.athleteRecordDate(record)}</td>
                <td>${CM.fmt(record.weight)} kg</td>
                <td>${(record.repetitions || []).length}회</td>
                <td style="white-space:normal">
                  ${CM.escape(record.memo || "")}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function snapshotsHTML() {
    const snapshots = (state.record.snapshots || []).filter(item => {
      return (
        Number.isFinite(item.t) &&
        item.t >= state.start &&
        item.t <= state.end &&
        typeof item.image === "string" &&
        /^data:image\/(?:jpeg|png|webp);base64,/i.test(item.image)
      );
    });

    if (!snapshots.length) {
      return CM.chartEmpty(
        "선택 구간에 저장된 장면이 없습니다."
      );
    }

    return `
      <div class="grid g3">
        ${snapshots.map(item => `
          <figure class="snapshot-card" style="margin:0">
            <img
              class="snapshot"
              src="${CM.escape(item.image)}"
              alt="${CM.fmt(item.t)}초 분석 장면"
            >

            <figcaption>
              ${CM.fmt(item.t)}초
            </figcaption>
          </figure>
        `).join("")}
      </div>
    `;
  }

  function evaluationAxes(record) {
    const scores = record?.coachEvaluation?.scores || [];

    return CM.reportAxes.map((name, index) => ({
      name,
      value:
        Number.isFinite(scores[index]) &&
        scores[index] >= 0 &&
        scores[index] <= 100
          ? scores[index]
          : null
    }));
  }

  function coachHTML() {
    const record = state.record;
    const evaluation = record.coachEvaluation || {};

    const previous = previousRecord();

    const previousAxes =
      previous?.coachEvaluation?.criteria &&
      previous.coachEvaluation.criteria === evaluation.criteria
        ? evaluationAxes(previous)
        : null;

    return `
      <div class="grid g2">
        <div>
          <h3>육각형 코치 평가</h3>

          <div id="rp-radar">
            ${CM.radar(
              evaluationAxes(record),
              previousAxes
            )}
          </div>

          <p class="notice">
            코치가 입력한 0~100 평가입니다.
            자동 측정 점수나 의학적 판정이 아닙니다.
            6개 항목이 입력되면 도형이 완성됩니다.
          </p>
        </div>

        <div class="stack">
          <label>
            평가 기준·코치명
            <textarea
              id="rp-criteria"
              maxlength="2000"
              placeholder="점수 기준과 평가자를 기록하세요."
            >${CM.escape(evaluation.criteria || "")}</textarea>
          </label>

          <div class="form-grid">
            ${CM.reportAxes.map((name, index) => `
              <label>
                ${name} · 0~100
                <input
                  data-coach-score="${index}"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value="${
                    Number.isFinite(evaluation.scores?.[index])
                      ? evaluation.scores[index]
                      : ""
                  }"
                  placeholder="미평가"
                >
              </label>
            `).join("")}
          </div>
        </div>
      </div>

      <div class="grid g2" style="margin-top:20px">
        <label>
          잘된 점
          <textarea
            id="rp-strengths"
            maxlength="3000"
          >${CM.escape(record.coachStrengths || "")}</textarea>
        </label>

        <label>
          우선 보완할 점 · 부위·방향·시점
          <textarea
            id="rp-priorities"
            maxlength="3000"
            placeholder="예: 3회차 왼쪽 무릎 위치 확인, 12.4초 장면"
          >${CM.escape(record.coachPriorities || "")}</textarea>
        </label>

        <label>
          코치 의견
          <textarea
            id="rp-feedback"
            maxlength="5000"
          >${CM.escape(record.coachFeedback || "")}</textarea>
        </label>

        <label>
          다음 측정 목표
          <textarea
            id="rp-goal"
            maxlength="3000"
          >${CM.escape(record.nextGoal || "")}</textarea>
        </label>
      </div>

      <label style="margin-top:16px">
        분석 메모
        <textarea
          id="rp-memo"
          maxlength="3000"
        >${CM.escape(record.memo || "")}</textarea>
      </label>

      <div class="row no-print" style="margin-top:16px">
        <button id="rp-save-coach" class="primary">
          피드백 저장
        </button>

        <button id="rp-add-training">
          보완점으로 훈련 작성
        </button>

        <span id="rp-save-state" class="notice">
          저장된 내용
        </span>
      </div>
    `;
  }

  function drawDetails() {
    const samples = selectedSamples();

    $("rp-angle-chart").innerHTML = CM.lineChart(
      angleSeries(samples),
      {
        min: 0,
        max: 180,
        unit: "°",
        title: "관절 각도 변화"
      }
    );

    $("rp-angle-table").innerHTML = statTable(samples);

    const difference = samples.map(sample => {
      const left = sample.angles?.["left_" + state.joint];
      const right = sample.angles?.["right_" + state.joint];

      return {
        x: sample.t,
        y:
          Number.isFinite(left) && Number.isFinite(right)
            ? left - right
            : null
      };
    });

    $("rp-difference").innerHTML = CM.lineChart(
      [{
        name: "왼쪽 − 오른쪽",
        data: difference,
        color: CM.colors[2]
      }],
      { unit: "°" }
    );

    $("rp-observations").innerHTML =
      CM.reportObservations(samples, state.joint)
        .map(item => `
          <div class="feedback-card">
            <p>${CM.escape(item.text)}</p>
          </div>
        `).join("");

    $("rp-reps").innerHTML = repsHTML();
    $("rp-alignment").innerHTML = alignmentHTML(samples);
    $("rp-snapshots").innerHTML = snapshotsHTML();
    $("rp-history").innerHTML = historyHTML();
    $("rp-quality").innerHTML = qualityHTML(samples);

    $("rp-range-label").textContent =
      CM.fmt(state.start) + "초 ~ " +
      CM.fmt(state.end) + "초";

    $("rp-sample-count").textContent =
      String(samples.length);

    $("rp-rep-count").textContent =
      String(repData().length);

    if (unbindChart) unbindChart();

    unbindChart = CM.bindChartSeek(
      $("rp-angle-chart"),
      function (time) {
        showFrame(time).catch(error => {
          CM.toast(error.message);
        });
      }
    );
  }

  /* -------------------------------------------------------
     그래프 시점 보기
     저장된 장면은 가장 가까운 이미지로 표시합니다.
     원본이 저장되어 있으면 정확한 시점으로 이동합니다.
     ------------------------------------------------------- */

  async function showFrame(time) {
    const record = state.record;

    const media = record.mediaId
      ? await CM.db.get("media", record.mediaId)
      : null;

    if (!state.active || record.id !== state.record.id) {
      return;
    }

    if (media?.blob instanceof Blob) {
      const url = URL.createObjectURL(media.blob);

      CM.modal(
        `
          <h2>${CM.fmt(time)}초 영상 확인</h2>

          <video
            id="rp-frame-video"
            controls
            playsinline
            preload="metadata"
            style="width:100%;background:#000;border-radius:10px"
          ></video>

          <p class="notice">
            원본 영상입니다. 스켈레톤 상세 확인은 비교분석을 이용하세요.
          </p>
        `,
        function () {
          const video = $("rp-frame-video");
          const dialog = $("modal");

          video.src = url;

          video.onloadedmetadata = function () {
            if (Number.isFinite(video.duration)) {
              video.currentTime = CM.clamp(
                time,
                0,
                Math.max(0, video.duration - 0.01)
              );
            }
          };

          dialog.addEventListener(
            "close",
            function () {
              video.pause();
              video.removeAttribute("src");
              video.load();
              URL.revokeObjectURL(url);
            },
            { once: true }
          );
        }
      );

      return;
    }

    const snapshots = (record.snapshots || []).filter(item => {
      return (
        Number.isFinite(item.t) &&
        typeof item.image === "string" &&
        /^data:image\/(?:jpeg|png|webp);base64,/i.test(item.image)
      );
    });

    const nearest = snapshots.reduce((best, item) => {
      return !best ||
        Math.abs(item.t - time) < Math.abs(best.t - time)
          ? item
          : best;
    }, null);

    CM.modal(`
      <h2>${CM.fmt(time)}초 선택</h2>

      ${
        nearest
          ? `
            <img
              class="snapshot"
              src="${CM.escape(nearest.image)}"
              alt="가장 가까운 저장 장면"
            >

            <p class="notice">
              원본 영상이 없어 가장 가까운 저장 장면
              ${CM.fmt(nearest.t)}초를 표시합니다.
              선택 시점과 동일한 장면은 아닐 수 있습니다.
            </p>
          `
          : `
            <p class="notice">
              원본 영상과 저장 장면이 없습니다.
              비교분석에서 원본 영상을 다시 연결할 수 있습니다.
            </p>
          `
      }
    `);
  }

  function evaluationFromForm() {
    const scores = [...main.querySelectorAll(
      "[data-coach-score]"
    )].map(input => {
      if (input.value.trim() === "") return null;

      const value = Number(input.value);

      if (
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100
      ) {
        throw new Error("코치 평가는 0~100으로 입력하세요.");
      }

      return value;
    });

    const criteria = $("rp-criteria").value.trim();

    if (scores.some(Number.isFinite) && !criteria) {
      throw new Error("육각형 평가 기준과 평가자를 입력하세요.");
    }

    return { scores, criteria };
  }

  async function saveCoach() {
    if (state.saving) return false;

    const evaluation = evaluationFromForm();

    state.saving = true;

    $("rp-save-coach").disabled = true;

    try {
      const latest = await CM.db.get(
        "records",
        state.record.id
      );

      if (!latest) {
        throw new Error("해당 분석 기록이 삭제되었습니다.");
      }

      const updated = {
        ...latest,

        coachEvaluation: evaluation,

        coachStrengths: $("rp-strengths").value.trim(),
        coachPriorities: $("rp-priorities").value.trim(),
        coachFeedback: $("rp-feedback").value.trim(),
        nextGoal: $("rp-goal").value.trim(),
        memo: $("rp-memo").value.trim(),

        updatedAt: new Date().toISOString()
      };

      await CM.db.put("records", updated);

      state.record = updated;

      records = records.map(record => {
        return record.id === updated.id ? updated : record;
      });

      state.dirty = false;

      $("rp-save-state").textContent = "저장 완료";

      const previous = previousRecord();

      $("rp-radar").innerHTML = CM.radar(
        evaluationAxes(updated),

        previous?.coachEvaluation?.criteria === evaluation.criteria &&
        evaluation.criteria
          ? evaluationAxes(previous)
          : null
      );

      CM.toast("코치 피드백을 저장했습니다.");

      return true;
    } finally {
      state.saving = false;

      if (state.active) {
        $("rp-save-coach").disabled = false;
      }
    }
  }

  async function goTraining() {
    if (state.dirty) {
      const saved = await saveCoach();
      if (!saved) return;
    }

    CM.selectedAthlete = state.record.athleteId || "";

    CM.trainingDraft = {
      athleteId: state.record.athleteId || "",
      athleteName: state.record.athleteName || "임시 분석",
      sourceRecordId: state.record.id,
      reason: state.record.coachPriorities || "",
      goal: state.record.nextGoal || ""
    };

    location.hash = "training";
  }

  function safe(handler) {
    return async function (event) {
      try {
        await handler(event);
      } catch (error) {
        CM.toast(error.message || "작업을 완료하지 못했습니다.");
      }
    };
  }

  function allowLeave() {
    if (state.saving) {
      CM.toast("저장이 끝날 때까지 기다려 주세요.");
      return false;
    }

    return !state.dirty || window.confirm(
      "저장하지 않은 피드백이 있습니다. 이동할까요?"
    );
  }

  function renderRecord(record) {
    state.record = record;
    state.dirty = false;

    CM.selectedRecord = record.id;

    const samples = CM.recordSamples(record);

    state.start = samples[0]?.t || 0;
    state.end = samples[samples.length - 1]?.t || 0;

    const savedMetric = record.exercise?.metric;

    state.joint = Object.hasOwn(
      CM.poseJoints,
      savedMetric || ""
    )
      ? savedMetric
      : "knee";

    const sectionNames = [
      ["summary", "요약"],
      ["angles", "관절"],
      ["reps", "반복"],
      ["alignment", "정렬·궤적"],
      ["snapshots", "장면"],
      ["history", "이전 기록"],
      ["quality", "측정 상태"],
      ["coach", "코치 피드백"]
    ];

    $("rp-content").innerHTML = `
      <section class="panel">
        <div class="eyebrow">CODEON MOTION REPORT</div>

        <h2>${CM.escape(record.athleteName || "임시 분석")}</h2>

        <h1>${CM.escape(CM.athleteRecordExercise(record))}</h1>

        <p class="muted">
          ${CM.athleteRecordDate(record)}
          · ${CM.reportViewNames[record.view] || "방향 미지정"}
          · ${CM.fmt(record.weight)} kg
        </p>

        <div class="grid g3" style="margin-top:20px">
          <div>
            <small>선택 구간</small>
            <p id="rp-range-label"></p>
          </div>

          <div>
            <small>저장 표본</small>
            <div id="rp-sample-count" class="metric">0</div>
          </div>

          <div>
            <small>구간 내 반복 기록</small>
            <div id="rp-rep-count" class="metric">0</div>
          </div>
        </div>
      </section>

      <section class="panel no-print">
        <div class="form-grid">
          <label>
            관절
            <select id="rp-joint">
              ${Object.entries(CM.poseJoints).map(
                ([key, value]) => `
                  <option
                    value="${key}"
                    ${key === state.joint ? "selected" : ""}
                  >
                    ${value.name}
                  </option>
                `
              ).join("")}
            </select>
          </label>

          <label>
            신체 좌우
            <select id="rp-side">
              <option value="both">양쪽</option>
              <option value="left">왼쪽</option>
              <option value="right">오른쪽</option>
            </select>
          </label>

          <label>
            시작 · 초
            <input
              id="rp-start"
              type="number"
              step="0.1"
              value="${state.start}"
            >
          </label>

          <label>
            종료 · 초
            <input
              id="rp-end"
              type="number"
              step="0.1"
              value="${state.end}"
            >
          </label>
        </div>

        <button id="rp-apply-range" style="margin-top:14px">
          선택 적용
        </button>
      </section>

      <nav class="tabs report-tabs no-print" aria-label="리포트 항목">
        ${sectionNames.map(([id, title]) => `
          <button data-scroll-section="${id}">
            ${title}
          </button>
        `).join("")}
      </nav>

      ${section(
        "summary",
        "측정 결과 요약",
        `
          <div id="rp-observations"></div>

          <p class="notice">
            자동 설명은 관찰된 측정값을 요약합니다.
            보완 우선순위와 원인 판단은 코치 의견에서 작성합니다.
          </p>
        `
      )}

      ${section(
        "angles",
        "관절 상세",
        `
          <div id="rp-angle-chart"></div>

          <p class="notice">
            그래프를 누르면 원본 또는 저장 장면을 확인합니다.
          </p>

          <div id="rp-angle-table" style="margin-top:18px"></div>

          <h3 style="margin-top:24px">좌우 각도 차이</h3>
          <div id="rp-difference"></div>
        `
      )}

      ${section(
        "reps",
        "반복·동작 패턴",
        '<div id="rp-reps"></div>'
      )}

      ${section(
        "alignment",
        "몸통·정렬·궤적",
        '<div id="rp-alignment"></div>'
      )}

      ${section(
        "snapshots",
        "주요 장면",
        '<div id="rp-snapshots"></div>'
      )}

      ${section(
        "history",
        "누적 기록 비교",
        '<div id="rp-history"></div>'
      )}

      ${section(
        "quality",
        "측정 상태",
        '<div id="rp-quality"></div>'
      )}

      ${section(
        "coach",
        "코치 피드백·육각형",
        coachHTML()
      )}
    `;

    $("rp-side").value = state.side;

    $("rp-apply-range").onclick = function () {
      const start = Number($("rp-start").value);
      const end = Number($("rp-end").value);

      if (
        $("rp-start").value === "" ||
        $("rp-end").value === "" ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start > end ||
        start < (samples[0]?.t || 0) ||
        end > (samples[samples.length - 1]?.t || 0)
      ) {
        CM.toast("측정 기록 안에서 올바른 시작·종료 구간을 입력하세요.");
        return;
      }

      state.start = start;
      state.end = end;
      state.joint = $("rp-joint").value;
      state.side = $("rp-side").value;

      drawDetails();
    };

    main.querySelectorAll(
      "[data-scroll-section]"
    ).forEach(button => {
      button.onclick = function () {
        $("rp-section-" + button.dataset.scrollSection)
          .scrollIntoView({ behavior: "smooth", block: "start" });
      };
    });

    main.querySelectorAll(
      "[data-print-section]"
    ).forEach(input => {
      input.onchange = function () {
        $("rp-section-" + input.dataset.printSection)
          .classList.toggle("no-print", !input.checked);
      };
    });

    main.querySelectorAll(
      "#rp-section-coach textarea, #rp-section-coach input"
    ).forEach(input => {
      input.addEventListener("input", function () {
        state.dirty = true;
        $("rp-save-state").textContent = "저장하지 않은 변경 내용";
      });
    });

    $("rp-save-coach").onclick = safe(saveCoach);
    $("rp-add-training").onclick = safe(goTraining);

    drawDetails();
  }

  /* ---------------------------------------------------------
     기록 선택 / 출력 / 삭제
     --------------------------------------------------------- */

  $("rp-search").oninput = options;

  $("rp-record").onchange = function () {
    const next = records.find(record => {
      return record.id === $("rp-record").value;
    });

    if (!next) return;

    if (!allowLeave()) {
      $("rp-record").value = state.record.id;
      return;
    }

    renderRecord(next);
  };

  $("rp-csv").onclick = function () {
    CM.exportRecordCSV(state.record);
  };

  $("rp-print").onclick = safe(async function () {
    if (state.dirty) {
      const saved = await saveCoach();
      if (!saved) return;
    }

    // 긴 코치 의견이 textarea 높이 때문에 잘리지 않도록
    // 인쇄하는 동안 일반 텍스트로 치환합니다.
    const replacements = [];

    $("rp-content").querySelectorAll("textarea").forEach(input => {
      const paragraph = document.createElement("div");

      paragraph.textContent = input.value || "—";
      paragraph.style.whiteSpace = "pre-wrap";
      paragraph.style.padding = "10px 0";

      input.insertAdjacentElement("afterend", paragraph);

      replacements.push({
        input,
        paragraph,
        display: input.style.display
      });

      input.style.display = "none";
    });

    function restore() {
      replacements.forEach(item => {
        item.input.style.display = item.display;
        item.paragraph.remove();
      });

      window.removeEventListener("afterprint", restore);
    }

    window.addEventListener("afterprint", restore, { once: true });

    try {
      window.print();
    } catch (error) {
      restore();
      throw error;
    }
  });

  $("rp-compare").onclick = function () {
    if (!allowLeave()) return;

    state.dirty = false;

    CM.selectedAthlete = state.record.athleteId || "";
    CM.selectedRecord = state.record.id;

    location.hash = "compare";
  };

  $("rp-training").onclick = safe(goTraining);

  $("rp-delete").onclick = safe(async function () {
    if (state.saving) return;

    const accepted = window.confirm(
      "이 분석 기록과 연결된 원본 영상을 삭제할까요?\n" +
      "이 작업은 되돌릴 수 없습니다.\n" +
      "별도로 작성한 훈련 기록은 유지됩니다."
    );

    if (!accepted) return;

    const record = state.record;

    const database = await CM.db.open();

    await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        ["records", "media"],
        "readwrite"
      );

      transaction.oncomplete = resolve;

      transaction.onerror = () => {
        reject(transaction.error || new Error("삭제 실패"));
      };

      transaction.onabort = () => {
        reject(transaction.error || new Error("삭제 취소"));
      };

      transaction.objectStore("records").delete(record.id);

      const mediaShared = records.some(item => {
        return (
          item.id !== record.id &&
          item.mediaId &&
          item.mediaId === record.mediaId
        );
      });

      if (record.mediaId && !mediaShared) {
        transaction.objectStore("media").delete(record.mediaId);
      }
    });

    state.dirty = false;
    CM.selectedRecord = null;

    CM.toast("분석 기록을 삭제했습니다.");

    if (CM.reportsCleanup) {
      CM.reportsCleanup();
    }

    await CM.renderReports();
  });

  function beforeUnload(event) {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  window.addEventListener("beforeunload", beforeUnload);

  /* app.js가 화면 전환 전에 호출합니다. */
  CM.reportsCanLeave = allowLeave;

  /* app.js가 화면을 떠날 때 호출합니다. */
  CM.reportsCleanup = function () {
    state.active = false;

    if (unbindChart) {
      unbindChart();
      unbindChart = null;
    }

    window.removeEventListener(
      "beforeunload",
      beforeUnload
    );

    CM.reportsCanLeave = null;
    CM.reportsCleanup = null;
  };

  renderRecord(chosen);
  options();
};

/* 코치 피드백 메뉴도 같은 기록 기반 화면을 사용합니다. */
CM.renderFeedback = async function () {
  await CM.renderReports();

  const section = document.getElementById(
    "rp-section-coach"
  );

  if (section) {
    section.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
};