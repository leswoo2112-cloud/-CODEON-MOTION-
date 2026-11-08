/*
  실버스타 스포츠 과학원 · CODEON MOTION
  reports.js — 통합 교체본

  - 자동 리포트
  - 육각형 참고 지표
  - 부위 / 좌우 / 시간 구간 선택
  - 각도 / 위치 꺾은선
  - 반복별 막대 / 반복 곡선 비교
  - 손목 / 발목 / 골반 궤적
  - 저장 스켈레톤 시점 확인
  - 원본 영상에서 자동 사진 추출
  - 논문 비교 참고 자료
  - 코치 메모 / 훈련 연결 / CSV / 인쇄

  모든 통계는 저장된 원본 측정값으로 계산합니다.
  보기용 평균선은 원본 기록이나 점수를 수정하지 않습니다.
*/

(() => {
  "use strict";

  const CM = window.CM = window.CM || {};
  const finite = Number.isFinite;
  const esc = value => CM.escape(String(value ?? ""));
  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

  const jointNames = {
    shoulder: "어깨",
    elbow: "팔꿈치",
    hip: "고관절",
    knee: "무릎",
    ankle: "발목"
  };

  const partNames = {
    ...jointNames,
    wrist: "손목",
    trunk: "몸통",
    pelvis: "골반"
  };

  const pointIds = {
    shoulder: { left: 11, right: 12 },
    elbow: { left: 13, right: 14 },
    wrist: { left: 15, right: 16 },
    hip: { left: 23, right: 24 },
    knee: { left: 25, right: 26 },
    ankle: { left: 27, right: 28 }
  };

  const triples = {
    shoulder: { left: [23, 11, 13], right: [24, 12, 14] },
    elbow: { left: [11, 13, 15], right: [12, 14, 16] },
    hip: { left: [11, 23, 25], right: [12, 24, 26] },
    knee: { left: [23, 25, 27], right: [24, 26, 28] },
    ankle: { left: [25, 27, 31], right: [26, 28, 32] }
  };

  const edges = [
    [11, 12], [11, 13], [13, 15],
    [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27],
    [24, 26], [26, 28],
    [27, 29], [29, 31], [27, 31],
    [28, 30], [30, 32], [28, 32]
  ];

  const leftIds = new Set([11, 13, 15, 23, 25, 27, 29, 31]);
  const colors = [
    "#50daf2", "#f58cce", "#f5d76e", "#8ce5ac",
    "#b8a1ff", "#ffad75", "#7db5ff", "#dddddd"
  ];

  CM.reportViewNames = {
    front: "정면",
    side: "측면",
    back: "후면"
  };

  CM.reportAxes = [
    "가동범위 일관성",
    "템포 일관성",
    "좌우 각도 유사도",
    "몸통 움직임 일관성",
    "관절 관측률",
    "목표 반복 달성"
  ];

  const fmt = (value, digits = 1) =>
    finite(value) ? value.toFixed(digits) : "—";

  function stats(values) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;

    for (const value of values) {
      if (!finite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
      count++;
    }

    return count
      ? { min, max, mean: sum / count, range: max - min, count }
      : { min: null, max: null, mean: null, range: null, count: 0 };
  }

  function consistency(values) {
    const valid = values.filter(finite);
    if (valid.length < 3) return null;

    const mean = stats(valid).mean;
    if (!finite(mean) || mean <= 0) return null;

    const variance = valid.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0
    ) / valid.length;

    return clamp(100 * (1 - Math.sqrt(variance) / mean), 0, 100);
  }

  function validPoint(point, threshold = 0.55) {
    return Boolean(
      point &&
      finite(point.x) &&
      finite(point.y) &&
      (
        point.manual ||
        (finite(point.visibility) && point.visibility >= threshold)
      )
    );
  }

  CM.recordSamples = record => {
    const unique = new Map();

    for (const sample of record.samples || []) {
      if (finite(sample?.t)) unique.set(sample.t, sample);
    }

    return [...unique.values()].sort((a, b) => a.t - b.t);
  };

  CM.reportRecordLabel = record => {
    const date = new Date(record.createdAt || record.date);
    const dateLabel = finite(date.getTime())
      ? date.toLocaleString("ko-KR") : "날짜 없음";

    return [
      record.athleteName || "게스트",
      record.exercise?.name || "운동",
      dateLabel
    ].join(" · ");
  };

  CM.reportCompatible = (a, b) =>
    a.id !== b.id &&
    a.athleteId === b.athleteId &&
    (a.exerciseId || a.exercise?.id) ===
      (b.exerciseId || b.exercise?.id) &&
    a.view === b.view &&
    a.measurementVersion === b.measurementVersion &&
    a.angleDefinition === b.angleDefinition &&
    (a.poseConfig?.model || "") === (b.poseConfig?.model || "") &&
    (a.poseConfig?.visibilityThreshold ?? 0.55) ===
      (b.poseConfig?.visibilityThreshold ?? 0.55);

  CM.csvCell = value => {
    if (finite(value)) return String(value);

    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };

  CM.exportRecordCSV = record => {
    const angleKeys = Object.keys(jointNames).flatMap(joint => [
      `left_${joint}`, `right_${joint}`
    ]);

    const metricKeys = [
      "left_trunk", "right_trunk",
      "shoulderTilt", "hipTilt",
      "pelvisX", "pelvisY",
      "left_kneeToe", "right_kneeToe"
    ];

    const rows = [
      [
        "시간_s", ...angleKeys, ...metricKeys,
        "수동수정", "인식상태", "바벨_x", "바벨_y"
      ],
      ...CM.recordSamples(record).map(sample => [
        sample.t,
        ...angleKeys.map(key => sample.angles?.[key]),
        ...metricKeys.map(key => sample.metrics?.[key]),
        sample.manual ? "예" : "아니오",
        sample.quality?.status || "",
        sample.bar?.x,
        sample.bar?.y
      ])
    ];

    CM.download(
      `codeon-${record.id}.csv`,
      "\uFEFF" + rows.map(row =>
        row.map(CM.csvCell).join(",")
      ).join("\r\n"),
      "text/csv;charset=utf-8"
    );
  };

  function angle(sample, joint, side) {
    const value = sample.angles?.[`${side}_${joint}`];
    return finite(value) ? value : null;
  }

  function metric(sample, key) {
    const value = sample.metrics?.[key];
    return finite(value) ? value : null;
  }

  function point(sample, id, threshold = 0.55) {
    const candidate = sample.points?.[id];
    return validPoint(candidate, threshold) ? candidate : null;
  }

  function center(sample, ids, threshold = 0.55) {
    const selected = ids.map(id => point(sample, id, threshold));
    if (selected.some(item => !item)) return null;

    return {
      x: selected.reduce((sum, item) => sum + item.x, 0) / ids.length,
      y: selected.reduce((sum, item) => sum + item.y, 0) / ids.length
    };
  }

  function partPoint(sample, part, side, threshold = 0.55) {
    if (part === "pelvis") return center(sample, [23, 24], threshold);

    if (part === "trunk") {
      return center(
        sample,
        side === "left" ? [11, 23] : [12, 24],
        threshold
      );
    }

    return point(sample, pointIds[part][side], threshold);
  }

  function partValue(sample, part, side, mode, threshold) {
    if (mode !== "angle") {
      const p = partPoint(sample, part, side, threshold);
      return p ? (mode === "x" ? p.x : p.y) * 100 : null;
    }

    if (part === "wrist") return null;

    const required = part === "pelvis"
      ? [23, 24]
      : part === "trunk"
        ? side === "left" ? [11, 23] : [12, 24]
        : triples[part][side];

    if (!required.every(id => point(sample, id, threshold))) return null;

    if (part === "pelvis") return metric(sample, "hipTilt");
    if (part === "trunk") return metric(sample, `${side}_trunk`);
    return angle(sample, part, side);
  }

  function validReps(record) {
    return (record.repetitions || [])
      .filter(rep =>
        finite(rep.start) &&
        finite(rep.end) &&
        rep.end > rep.start
      )
      .slice()
      .sort((a, b) => a.start - b.start);
  }

  function repRange(samples, rep, getter) {
    const selected = samples.filter(sample =>
      sample.t >= rep.start && sample.t <= rep.end
    );

    const valid = selected.filter(sample => finite(getter(sample)));

    if (valid.length < 3 || !selected.length) return null;
    if (valid.length / selected.length < 0.7) return null;
    if (valid[0].t - rep.start > 0.25) return null;
    if (rep.end - valid[valid.length - 1].t > 0.25) return null;

    for (let index = 1; index < valid.length; index++) {
      if (valid[index].t - valid[index - 1].t > 0.8) return null;
    }

    return stats(valid.map(getter)).range;
  }

  function smooth(data) {
    const output = data.map(item => ({ ...item }));
    let start = 0;

    while (start < data.length) {
      if (!finite(data[start].y)) {
        start++;
        continue;
      }

      let end = start;

      while (
        end + 1 < data.length &&
        finite(data[end + 1].y) &&
        data[end + 1].x - data[end].x <= 0.8
      ) end++;

      for (let index = start; index <= end; index++) {
        const from = Math.max(start, index - 2);
        const to = Math.min(end, index + 2);
        let sum = 0;

        for (let cursor = from; cursor <= to; cursor++) {
          sum += data[cursor].y;
        }

        output[index].y = sum / (to - from + 1);
      }

      start = end + 1;
    }

    return output;
  }

  CM.reportObservations = (samples, joint = "knee") => {
    const paired = samples.filter(sample =>
      finite(angle(sample, joint, "left")) &&
      finite(angle(sample, joint, "right"))
    );

    return {
      left: stats(samples.map(sample => angle(sample, joint, "left"))),
      right: stats(samples.map(sample => angle(sample, joint, "right"))),
      pairedCount: paired.length,
      meanDifference: stats(paired.map(sample =>
        Math.abs(
          angle(sample, joint, "left") -
          angle(sample, joint, "right")
        )
      )).mean
    };
  };

  function papersFor(record) {
    const name = record.exercise?.name || "";
    const icon = record.exercise?.icon;

    if (icon === "squat" || /스쿼트|스쾃|squat/i.test(name)) {
      return [
        {
          name: "Fry 외 · 2003",
          url: "https://pubmed.ncbi.nlm.nih.gov/14636100/",
          subjects: "성인 남성 7명 · 평행 바벨 스쿼트",
          result:
            "무릎 전진 제한 여부에 따라 무릎과 고관절 토크가 달라졌습니다.",
          compare:
            "무릎 전진과 몸통 움직임을 함께 확인하는 참고 자료입니다.",
          limit:
            "현재 영상 각도만으로 실제 토크나 정상·비정상을 계산하지 않습니다."
        },
        {
          name: "백 스쿼트 반복측정 연구 · 2025",
          url: "https://pubmed.ncbi.nlm.nih.gov/40157154/",
          subjects: "건강한 참가자 16명 · 백 스쿼트",
          result:
            "몸통·정강이 상대 기울기와 무릎 굽힘이 " +
            "고관절·무릎 모멘트 비율과 관련되었습니다.",
          compare:
            "몸통 각도 하나만 보지 않고 여러 관절을 함께 비교합니다.",
          limit:
            "앱의 2D 측정 방법과 연구의 측정 방법은 동일하지 않습니다."
        }
      ];
    }

    if (icon === "pushup" || /푸시업|푸쉬업|팔굽혀|push.?up/i.test(name)) {
      return [
        {
          name: "Donkers 외 · 1993",
          url: "https://pubmed.ncbi.nlm.nih.gov/8514808/",
          subjects: "건강한 성인 남성 9명 · 여러 손 위치",
          result:
            "손 위치에 따라 푸시업 중 팔꿈치의 힘과 토크가 달라졌습니다.",
          compare:
            "손 위치가 다른 영상을 같은 조건으로 취급하지 않습니다.",
          limit:
            "특정 팔꿈치 각도 하나를 모든 사람의 정답으로 제시하지 않습니다."
        },
        {
          name: "Ebben 외 · 2011",
          url: "https://pubmed.ncbi.nlm.nih.gov/21873902/",
          subjects: "성인 23명 · 푸시업 변형 비교",
          result:
            "손을 높이거나 무릎을 댄 변형에서 최대 수직 지면반력이 낮았습니다.",
          compare:
            "지지 높이와 운동 변형을 구분해 비교합니다.",
          limit:
            "앱은 지면반력이나 개인의 부상 위험을 측정하지 않습니다."
        }
      ];
    }

    return [];
  }

  CM.renderReports = async () => {
    CM.reportsCleanup?.();
    await CM.loadExercises();

    const records = await CM.db.all("records");

    records.sort((a, b) =>
      (Date.parse(b.createdAt || b.date) || 0) -
      (Date.parse(a.createdAt || a.date) || 0)
    );

    const main = document.querySelector("#main");

    if (!records.length) {
      main.innerHTML =
        CM.heading("분석 리포트", "SILVERSTAR · AUTOMATIC REPORT") +
        CM.empty("분석 화면에서 측정값을 저장하면 리포트가 생성됩니다.");
      return;
    }

    let record =
      records.find(item => item.id === CM.selectedRecord) ||
      records.find(item => item.athleteId === CM.selectedAthlete) ||
      records[0];

    CM.selectedRecord = record.id;

    const samples = CM.recordSamples(record);
    const reps = validReps(record);
    const controller = new AbortController();
    const signal = controller.signal;

    let active = true;
    let dirty = false;
    let saving = false;
    let photoBusy = false;
    let photoVideo = null;
    let photoURL = null;
    let unbindSeek = null;
    let printCopies = [];

    const initialJoint = Object.hasOwn(jointNames, record.exercise?.metric)
      ? record.exercise.metric : "knee";

    const firstTime = samples[0]?.t ?? 0;
    const lastTime = samples[samples.length - 1]?.t ?? 0;

    const state = {
      part: initialJoint,
      joint: initialJoint,
      side: "both",
      scoreSide: "left",
      mode: "angle",
      threshold: 0.55,
      smooth: false,
      start: firstTime,
      end: lastTime,
      time: firstTime,
      lines: true,
      bars: true,
      paths: true,
      photos: true
    };

    const $ = selector => main.querySelector(selector);

    function section(title, body, group = "") {
      return `
        <section class="panel report-section"
          ${group ? `data-report-group="${group}"` : ""}
          style="margin-bottom:18px">
          <h2>${esc(title)}</h2>
          ${body}
        </section>
      `;
    }

    function on(selector, type, callback) {
      $(selector).addEventListener(type, event => {
        try {
          Promise.resolve(callback(event)).catch(error => {
            console.error(error);
            if (active) CM.toast(error.message || "작업에 실패했습니다.");
          });
        } catch (error) {
          console.error(error);
          CM.toast(error.message || "작업에 실패했습니다.");
        }
      }, { signal });
    }

    main.innerHTML = `
      ${CM.heading("자동 분석 리포트", "SILVERSTAR · CODEON MOTION", `
        <button id="rp-save" class="primary">코치 메모 저장</button>
        <button id="rp-csv">CSV</button>
        <button id="rp-print">인쇄 / PDF</button>
      `)}

      <section class="panel no-print" style="margin-bottom:18px">
        <label>분석 기록
          <select id="rp-record">
            ${records.map(item => `
              <option value="${esc(item.id)}"
                ${item.id === record.id ? "selected" : ""}>
                ${esc(CM.reportRecordLabel(item))}
              </option>
            `).join("")}
          </select>
        </label>

        <div class="grid g3" style="margin-top:14px">
          <label>자세히 볼 부위
            <select id="rp-part">
              ${Object.entries(partNames).map(([key, name]) => `
                <option value="${key}"
                  ${key === state.part ? "selected" : ""}>
                  ${name}
                </option>
              `).join("")}
            </select>
          </label>

          <label>방향
            <select id="rp-side">
              <option value="both">좌우 모두</option>
              <option value="left">왼쪽만</option>
              <option value="right">오른쪽만</option>
            </select>
          </label>

          <label>상세 그래프 내용
            <select id="rp-mode">
              <option value="angle">각도 변화</option>
              <option value="x">가로 위치 변화</option>
              <option value="y">세로 위치 변화</option>
            </select>
          </label>
        </div>

        <div class="grid g3" style="margin-top:14px">
          <label>반복 비교 관절
            <select id="rp-joint">
              ${Object.entries(jointNames).map(([key, name]) => `
                <option value="${key}"
                  ${key === state.joint ? "selected" : ""}>
                  ${name}
                </option>
              `).join("")}
            </select>
          </label>

          <label>육각형 기준 방향
            <select id="rp-score-side">
              <option value="left">왼쪽</option>
              <option value="right">오른쪽</option>
            </select>
          </label>

          <label>그래프 표시
            <select id="rp-smoothing">
              <option value="raw">원본 측정값</option>
              <option value="mean">보기용 5표본 평균선</option>
            </select>
          </label>
        </div>

        <div class="grid g3" style="margin-top:14px">
          <label>시작 초
            <input id="rp-start" type="number"
              step="0.01" value="${firstTime}">
          </label>
          <label>종료 초
            <input id="rp-end" type="number"
              step="0.01" value="${lastTime}">
          </label>
          <label>표시용 가시성 필터
            <select id="rp-threshold">
              <option value="0.55">기본 · 0.55 이상</option>
              <option value="0.75">엄격 · 0.75 이상</option>
              <option value="0.9">매우 엄격 · 0.90 이상</option>
            </select>
          </label>
        </div>

        <div class="row" style="margin-top:14px;gap:12px;flex-wrap:wrap">
          <button id="rp-full">전체 구간</button>
          <label><input id="rp-lines" type="checkbox" checked> 꺾은선</label>
          <label><input id="rp-bars" type="checkbox" checked> 막대</label>
          <label><input id="rp-paths" type="checkbox" checked> 궤적</label>
          <label><input id="rp-photos-toggle" type="checkbox" checked> 사진</label>
        </div>

        <p class="muted">
          선택 구간은 상세·시간 그래프와 궤적에 적용됩니다.
          육각형·반복 통계는 저장된 전체 기록 기준입니다.
          가시성 필터는 정확도 비율이 아니며, 저장 당시 제외한 점을 복원하지 않습니다.
        </p>
      </section>

      <div id="rp-summary"></div>
      <div id="rp-radar"></div>

      <section class="panel report-section" style="margin-bottom:18px">
        <h2>선택 부위 · 스켈레톤과 그래프</h2>
        <div id="rp-detail-chart" class="chart"></div>
        <p id="rp-detail-note" class="muted"></p>

        <input id="rp-time" type="range"
          min="${firstTime}" max="${Math.max(firstTime + 0.01, lastTime)}"
          value="${firstTime}" step="0.01"
          aria-label="스켈레톤 확인 시점"
          class="no-print" style="width:100%">

        <div id="rp-skeleton"></div>
      </section>

      <div id="rp-graphs"></div>

      <section id="rp-photo-section" class="panel report-section"
        style="margin-bottom:18px">
        <h2>동작 사진</h2>
        <p id="rp-photo-status" class="muted">저장된 사진 확인 중…</p>
        <div id="rp-photos" class="grid g3"></div>
      </section>

      <div id="rp-auto-feedback"></div>
      <div id="rp-research"></div>

      <section id="rp-section-coach" class="panel report-section">
        <h2>코치 추가 메모</h2>
        <div class="grid g2">
          <label>잘한 점
            <textarea id="rp-strengths" rows="4"></textarea>
          </label>
          <label>우선 확인할 점
            <textarea id="rp-priorities" rows="4"></textarea>
          </label>
          <label>코치 피드백
            <textarea id="rp-feedback" rows="5"></textarea>
          </label>
          <label>다음 목표
            <textarea id="rp-goal" rows="5"></textarea>
          </label>
        </div>

        <label style="display:block;margin-top:12px">기록 메모
          <textarea id="rp-memo" rows="3"></textarea>
        </label>

        <div class="row no-print"
          style="gap:8px;flex-wrap:wrap;margin-top:14px">
          <button id="rp-training" class="primary">추가 훈련 계획</button>
          <button id="rp-compare">기록 비교</button>
        </div>
      </section>
    `;

    const fields = {
      "rp-strengths": "coachStrengths",
      "rp-priorities": "coachPriorities",
      "rp-feedback": "coachFeedback",
      "rp-goal": "nextGoal",
      "rp-memo": "memo"
    };

    for (const [id, key] of Object.entries(fields)) {
      $(`#${id}`).value = record[key] || "";
      on(`#${id}`, "input", () => { dirty = true; });
    }

    let automaticNotes = [];
    let automaticAxes = [];

    function selectedSamples() {
      return samples.filter(sample =>
        sample.t >= state.start && sample.t <= state.end
      );
    }

    function selectedSides(part = null) {
      if (part === "pelvis") return ["left"];
      return state.side === "both" ? ["left", "right"] : [state.side];
    }

    function series(name, getter, color) {
      const data = selectedSamples().map(sample => ({
        x: sample.t,
        y: getter(sample)
      }));

      return {
        name,
        color,
        data: state.smooth ? smooth(data) : data
      };
    }

    function line(items, unit = "°") {
      return `<div class="chart">${CM.lineChart(items, {
        unit,
        maxGap: 0.8,
        xMin: state.start,
        xMax: Math.max(state.start + 0.01, state.end)
      })}</div>`;
    }

    function bars(items, unit) {
      if (!items.some(item => finite(item.value))) {
        return CM.empty("계산에 필요한 유효 자료가 부족합니다.");
      }

      return `<div class="chart">${CM.barChart(items, unit)}</div>`;
    }

    function showSummary() {
      const validSamples = samples.filter(sample =>
        (sample.points || []).some(p => validPoint(p))
      ).length;

      $("#rp-summary").innerHTML = section("기록 요약", `
        <div class="grid g3">
          <div><span class="muted">선수</span>
            <h3>${esc(record.athleteName || "게스트")}</h3>
          </div>
          <div><span class="muted">운동</span>
            <h3>${esc(record.exercise?.name || "운동")}</h3>
          </div>
          <div><span class="muted">촬영 방향</span>
            <h3>${esc(CM.reportViewNames[record.view] || "미지정")}</h3>
          </div>
        </div>
        <p>
          저장 표본 ${samples.length}개 ·
          기준점이 있는 표본 ${validSamples}개 ·
          반복 구간 ${reps.length}개
        </p>
        <p class="muted">
          모델: ${esc(record.poseConfig?.model || "기존 기록")} ·
          분석값은 영상 기반 2D 추정입니다.
        </p>
      `);
    }

    function showRadarAndFeedback() {
      const joint = state.joint;
      const side = state.scoreSide;

      const roms = reps.map(rep => repRange(
        samples, rep, sample => angle(sample, joint, side)
      )).filter(finite);

      const durations = reps.map(rep => rep.end - rep.start);

      const trunkRanges = reps.map(rep => repRange(
        samples, rep, sample => metric(sample, `${side}_trunk`)
      )).filter(finite);

      const paired = samples.filter(sample =>
        finite(angle(sample, joint, "left")) &&
        finite(angle(sample, joint, "right"))
      );

      const difference = stats(paired.map(sample =>
        Math.abs(angle(sample, joint, "left") - angle(sample, joint, "right"))
      ));

      const validCount = samples.filter(sample =>
        finite(angle(sample, joint, side))
      ).length;

      const observationRate = samples.length
        ? 100 * validCount / samples.length : null;

      const target = Number(record.targetReps);
      const bilateralView = ["front", "back"].includes(record.view);

      const scores = [
        consistency(roms),
        consistency(durations),
        bilateralView && paired.length >= 10
          ? clamp(100 * (1 - difference.mean / 30), 0, 100) : null,
        consistency(trunkRanges),
        samples.length >= 10 ? observationRate : null,
        record.exercise?.mode === "reps" && finite(target) && target > 0
          ? clamp(100 * reps.length / target, 0, 100) : null
      ];

      automaticAxes = CM.reportAxes.map((name, index) => ({
        name,
        value: scores[index]
      }));

      $("#rp-radar").innerHTML = section("자동 육각형 · 참고 지표", `
        <div class="grid g2">
          <div class="chart">${CM.radar(automaticAxes)}</div>
          <div>
            <p>
              ${side === "left" ? "왼쪽" : "오른쪽"}
              ${jointNames[joint]} 기준 · 전체 기록
            </p>
            <table>
              <thead><tr><th>항목</th><th>참고 점수</th></tr></thead>
              <tbody>
                ${automaticAxes.map(axis => `
                  <tr>
                    <td>${esc(axis.name)}</td>
                    <td>${finite(axis.value)
                      ? `${fmt(axis.value, 0)} / 100`
                      : "자료 부족·적용 제외"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
        <p class="muted">
          논문으로 검증된 자세 점수가 아닙니다.
          높은 일관성은 올바른 자세나 높은 근력을 뜻하지 않습니다.
          편측·교대 운동에서는 좌우 유사도를 수행 평가로 사용하지 마세요.
        </p>
        <details>
          <summary>계산 기준 보기</summary>
          <ul>
            <li>
              일관성: 100 × (1 − 표준편차 / 평균).
              유효 반복 3개 이상, 0~100 제한.
            </li>
            <li>
              좌우 유사도: 100 × (1 − 평균 절대 각도 차이 / 30°).
              30°는 앱 표시 기준이며 의학적 허용치가 아닙니다.
            </li>
            <li>
              관측률: 선택 관절 유효 표본 / 저장 표본.
              전체 영상 분석률이나 측정 정확도가 아닙니다.
            </li>
            <li>
              목표 달성: 저장 반복 / 설정 목표.
              자동 감지 구간은 실제 반복과 일치하는지 확인해야 합니다.
            </li>
          </ul>
        </details>
      `);

      const observed = stats(samples.map(sample => angle(sample, joint, side)));
      const timing = stats(durations);
      const ranges = stats(roms);

      automaticNotes = [
        observed.count
          ? `${side === "left" ? "왼쪽" : "오른쪽"} ${jointNames[joint]}에서 ` +
            `${fmt(observed.min)}~${fmt(observed.max)}°가 관측되었습니다. ` +
            "준비·휴식 구간도 포함될 수 있습니다."
          : "선택 관절의 유효 측정값이 부족합니다.",
        ranges.count
          ? `유효 반복 ${ranges.count}개의 평균 각도 변화 폭은 ` +
            `${fmt(ranges.mean)}°입니다. 반복 간 차이는 그래프에서 확인하세요.`
          : "반복별 가동범위를 계산하기에 유효 자료가 부족합니다.",
        timing.count
          ? `반복 시간은 평균 ${fmt(timing.mean, 2)}초, ` +
            `최소 ${fmt(timing.min, 2)}초, 최대 ${fmt(timing.max, 2)}초입니다.`
          : "저장된 반복 구간이 없습니다.",
        bilateralView && difference.count
          ? `같은 시점의 좌우 각도 차이는 평균 ${fmt(difference.mean)}°입니다. ` +
            "운동의 편측 여부와 카메라 구도를 먼저 확인하세요."
          : "촬영 방향 또는 동시 측정값 부족으로 좌우 평가를 보류합니다."
      ];

      $("#rp-auto-feedback").innerHTML = section("자동 측정 피드백", `
        <div class="grid g2">
          ${automaticNotes.map((text, index) => `
            <article class="panel">
              <h3>${["관절 움직임", "반복별 범위", "수행 시간", "좌우 비교"][index]}</h3>
              <p>${esc(text)}</p>
            </article>
          `).join("")}
        </div>
        <p class="muted">
          측정 결과를 설명한 내용입니다.
          근력 부족·부상·교정 필요 여부를 자동 진단하지 않습니다.
          다음 촬영에서는 같은 구도와 운동 조건을 유지해 비교하세요.
        </p>
      `);
    }

    function nearestSample(time) {
      let low = 0;
      let high = samples.length - 1;

      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (samples[middle].t < time) low = middle + 1;
        else high = middle;
      }

      const candidates = [samples[low], samples[low - 1]]
        .filter(Boolean)
        .sort((a, b) => Math.abs(a.t - time) - Math.abs(b.t - time));

      return candidates[0] && Math.abs(candidates[0].t - time) <= 0.2
        ? candidates[0] : null;
    }

    function showSkeleton() {
      const sample = nearestSample(state.time);

      if (!sample) {
        $("#rp-skeleton").innerHTML =
          CM.empty(`${fmt(state.time, 2)}초에 가까운 저장 표본이 없습니다.`);
        return;
      }

      const width = finite(record.width) && record.width > 0 ? record.width : 1280;
      const height = finite(record.height) && record.height > 0 ? record.height : 720;
      const scale = Math.max(width, height) / 800;
      const selected = new Set();

      for (const side of selectedSides(state.part)) {
        const ids = state.part === "pelvis"
          ? [23, 24]
          : state.part === "trunk"
            ? side === "left" ? [11, 23] : [12, 24]
            : triples[state.part] && state.mode === "angle"
              ? triples[state.part][side]
              : [pointIds[state.part][side]];

        ids.forEach(id => selected.add(id));
      }

      const lines = edges.map(([a, b]) => {
        const pa = point(sample, a, state.threshold);
        const pb = point(sample, b, state.threshold);
        if (!pa || !pb) return "";

        const color = selected.has(a) && selected.has(b)
          ? "#f5d76e" : leftIds.has(a) ? "#50daf2" : "#f58cce";

        return `<line x1="${pa.x * width}" y1="${pa.y * height}"
          x2="${pb.x * width}" y2="${pb.y * height}"
          stroke="${color}" stroke-width="${3 * scale}"
          stroke-linecap="round"/>`;
      }).join("");

      const nodes = [...new Set(edges.flat())].map(id => {
        const p = point(sample, id, state.threshold);
        if (!p) return "";

        return `<circle cx="${p.x * width}" cy="${p.y * height}"
          r="${(selected.has(id) ? 6 : 3) * scale}"
          fill="${selected.has(id) ? "#f5d76e" :
            leftIds.has(id) ? "#50daf2" : "#f58cce"}"/>`;
      }).join("");

      const values = selectedSides(state.part).map(side => {
        const value = partValue(
          sample, state.part, side, state.mode, state.threshold
        );

        return `${state.part === "pelvis" ? "골반" :
          side === "left" ? "왼쪽" : "오른쪽"} ` +
          `${fmt(value)}${state.mode === "angle" ? "°" : "%"}`;
      }).join(" / ");

      $("#rp-skeleton").innerHTML = `
        <p>
          선택 ${fmt(state.time, 2)}초 ·
          저장 표본 ${fmt(sample.t, 2)}초 · ${esc(values)}
        </p>
        <svg xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 ${width} ${height}"
          role="img" aria-label="저장된 스켈레톤"
          style="width:100%;max-height:350px;background:#06121b;
                 border-radius:12px">
          ${lines}${nodes}
        </svg>
        <p class="muted">
          노란색은 선택 부위입니다. 원본 사진이 아니라 저장 기준점 재현입니다.
        </p>
      `;
    }

    function showDetail() {
      const selected = selectedSamples();

      const items = selectedSides(state.part).map(side => {
        const data = selected.map(sample => ({
          x: sample.t,
          y: partValue(sample, state.part, side, state.mode, state.threshold)
        }));

        return {
          name: state.part === "pelvis"
            ? "골반"
            : `${side === "left" ? "왼쪽" : "오른쪽"} ${partNames[state.part]}`,
          color: side === "left" ? colors[0] : colors[1],
          data: state.smooth ? smooth(data) : data
        };
      });

      $("#rp-detail-chart").innerHTML = CM.lineChart(items, {
        unit: state.mode === "angle" ? "°" : "%",
        maxGap: 0.8,
        xMin: state.start,
        xMax: Math.max(state.start + 0.01, state.end),
        currentTime: state.time
      });

      $("#rp-detail-note").textContent = state.mode === "angle"
        ? state.part === "wrist"
          ? "손목은 위치 그래프를 선택하세요. 손목 자체의 굽힘각은 제공하지 않습니다."
          : "관절은 2D 내부각, 몸통은 수직선 기준, 골반은 영상상 골반선 기울기입니다."
        : state.mode === "x"
          ? "영상 왼쪽 0% → 오른쪽 100%. 실제 거리(cm)가 아닙니다."
          : "영상 위쪽 0% → 아래쪽 100%. 실제 높이(cm)가 아닙니다.";

      showSkeleton();
    }

    function trajectory(title, getter) {
      const data = [];
      let previousTime = null;

      for (const sample of selectedSamples()) {
        if (previousTime !== null && sample.t - previousTime > 0.8) {
          data.push(null);
        }

        const p = getter(sample);
        data.push(p ? { x: p.x * 100, y: p.y * 100 } : null);
        previousTime = sample.t;
      }

      return section(title, `
        <div class="chart">${CM.trajectoryChart(data)}</div>
        <p class="muted">
          영상상 위치 궤적입니다. 카메라 이동·촬영 배율의 영향을 받습니다.
          실제 거리나 힘을 뜻하지 않습니다.
        </p>
      `, "paths");
    }

    function normalizedReps(side) {
      return reps.slice(0, 12).map((rep, index) => {
        const data = [];
        let previousTime = null;

        for (const sample of samples.filter(item =>
          item.t >= rep.start && item.t <= rep.end
        )) {
          const x = 100 * (sample.t - rep.start) / (rep.end - rep.start);

          if (previousTime !== null && sample.t - previousTime > 0.8) {
            data.push({ x, y: null });
          }

          data.push({
            x,
            y: angle(sample, state.joint, side)
          });

          previousTime = sample.t;
        }

        return {
          name: `${index + 1}회`,
          color: colors[index % colors.length],
          data
        };
      });
    }

    function showGraphs() {
      let html = "";

      for (const [joint, name] of Object.entries(jointNames)) {
        html += section(`${name} · 좌우 각도 변화`, line(
          selectedSides().map(side => series(
            `${side === "left" ? "왼쪽" : "오른쪽"} ${name}`,
            sample => partValue(sample, joint, side, "angle", state.threshold),
            side === "left" ? colors[0] : colors[1]
          ))
        ), "lines");
      }

      html += section("몸통 기울기 변화", line(
        selectedSides().map(side => series(
          `${side === "left" ? "왼쪽" : "오른쪽"} 기준`,
          sample => partValue(sample, "trunk", side, "angle", state.threshold),
          side === "left" ? colors[0] : colors[1]
        ))
      ), "lines");

      html += section("어깨선·골반선 기울기", line([
        series("어깨선", sample => {
          if (!point(sample, 11, state.threshold) ||
              !point(sample, 12, state.threshold)) return null;
          return metric(sample, "shoulderTilt");
        }, colors[0]),
        series("골반선", sample =>
          partValue(sample, "pelvis", "left", "angle", state.threshold),
          colors[1])
      ]) + `
        <p class="muted">영상상 선의 기울기이며 3D 회전각은 아닙니다.</p>
      `, "lines");

      html += section("골반 중심 · 가로 위치", line([
        series("가로 위치", sample =>
          partValue(sample, "pelvis", "left", "x", state.threshold), colors[3])
      ], "%"), "lines");

      html += section("골반 중심 · 세로 위치", line([
        series("세로 위치", sample =>
          partValue(sample, "pelvis", "left", "y", state.threshold), colors[2])
      ], "%"), "lines");

      const differenceSeries = series(
        "왼쪽 − 오른쪽",
        sample => {
          const left = partValue(
            sample, state.joint, "left", "angle", state.threshold
          );
          const right = partValue(
            sample, state.joint, "right", "angle", state.threshold
          );
          return finite(left) && finite(right) ? left - right : null;
        },
        colors[2]
      );

      html += section(
        `${jointNames[state.joint]} · 좌우 차이`,
        `<div class="chart">${CM.lineChart([differenceSeries], {
          unit: "°",
          min: -180,
          max: 180,
          maxGap: 0.8,
          xMin: state.start,
          xMax: Math.max(state.start + 0.01, state.end)
        })}</div>
        <p class="muted">
          양수는 왼쪽 각도가 더 큽니다.
          편측·교대 운동의 차이가 곧 이상을 의미하지는 않습니다.
        </p>`,
        "lines"
      );

      const rows = Object.entries(jointNames).map(([joint, name]) => {
        const left = stats(selectedSamples().map(sample =>
          partValue(sample, joint, "left", "angle", state.threshold)
        ));
        const right = stats(selectedSamples().map(sample =>
          partValue(sample, joint, "right", "angle", state.threshold)
        ));

        return `
          <tr>
            <td>${name}</td>
            <td>${fmt(left.min)} / ${fmt(left.max)}</td>
            <td>${fmt(left.range)}</td>
            <td>${fmt(right.min)} / ${fmt(right.max)}</td>
            <td>${fmt(right.range)}</td>
          </tr>
        `;
      }).join("");

      html += section("관절별 관측 범위 · 선택 구간", `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>관절</th><th>왼 최소/최대°</th><th>왼 변화 폭°</th>
              <th>오른 최소/최대°</th><th>오른 변화 폭°</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="muted">
          관측된 각도의 범위이며 신체의 최대 가동범위 검사가 아닙니다.
        </p>
      `);

      for (const side of selectedSides()) {
        const label = side === "left" ? "왼쪽" : "오른쪽";

        html += section(
          `${label} ${jointNames[state.joint]} · 반복별 가동범위`,
          bars(reps.map((rep, index) => ({
            label: `${index + 1}회`,
            name: `${index + 1}회`,
            value: repRange(samples, rep, sample =>
              angle(sample, state.joint, side)
            ),
            color: side === "left" ? colors[0] : colors[1]
          })), "°"),
          "bars"
        );

        html += section(
          `${label} ${jointNames[state.joint]} · 반복 곡선 비교`,
          reps.length
            ? `<div class="chart">${CM.lineChart(normalizedReps(side), {
                unit: "°",
                xUnit: "%",
                xMin: 0,
                xMax: 100,
                maxGap: 100
              })}</div>
              <p class="muted">
                시작 0% → 종료 100%. 첫 12개 반복을 비교합니다.
                원본 표본의 상대 시점만 변환하며 없는 값을 채우지 않습니다.
              </p>`
            : CM.empty("비교할 반복 구간이 없습니다."),
          "lines"
        );
      }

      for (const [title, getter, color] of [
        ["반복별 전체 시간", rep => rep.end - rep.start, colors[1]],
        ["반복별 하강 시간", rep =>
          finite(rep.bottom) && rep.bottom >= rep.start && rep.bottom <= rep.end
            ? rep.bottom - rep.start : null, colors[0]],
        ["반복별 상승 시간", rep =>
          finite(rep.bottom) && rep.bottom >= rep.start && rep.bottom <= rep.end
            ? rep.end - rep.bottom : null, colors[3]]
      ]) {
        html += section(title, bars(reps.map((rep, index) => ({
          label: `${index + 1}회`,
          name: `${index + 1}회`,
          value: getter(rep),
          color
        })), "s") + `
          <p class="muted">
            하강·상승은 저장된 최소 각도 시점 기준입니다.
            실제 운동 단계와 맞는지 확인하세요.
          </p>
        `, "bars");
      }

      for (const side of selectedSides()) {
        const label = side === "left" ? "왼쪽" : "오른쪽";

        html += trajectory(`${label} 손목 궤적`, sample =>
          point(sample, side === "left" ? 15 : 16, state.threshold)
        );

        html += trajectory(`${label} 발목 궤적`, sample =>
          point(sample, side === "left" ? 27 : 28, state.threshold)
        );
      }

      html += trajectory("골반 중심 궤적", sample =>
        center(sample, [23, 24], state.threshold)
      );

      const hasBar = samples.some(sample =>
        finite(sample.bar?.x) && finite(sample.bar?.y)
      );

      if (hasBar) {
        html += trajectory("수동 지정 바벨 점 궤적", sample =>
          finite(sample.bar?.x) && finite(sample.bar?.y) ? sample.bar : null
        );
      }

      const compatible = records.filter(item =>
        CM.reportCompatible(record, item)
      ).slice(0, 7).concat(record).sort((a, b) =>
        (Date.parse(a.createdAt || a.date) || 0) -
        (Date.parse(b.createdAt || b.date) || 0)
      );

      if (compatible.length >= 2) {
        html += section(
          "이전 기록과 관측 범위 비교",
          bars(compatible.map(item => {
            const values = stats(CM.recordSamples(item).map(sample =>
              angle(sample, state.joint, state.scoreSide)
            ));

            return {
              label: new Date(item.createdAt || item.date).toLocaleDateString("ko-KR"),
              name: item.exercise?.name || "운동",
              value: values.range,
              color: item.id === record.id ? colors[0] : colors[4]
            };
          }), "°") + `
            <p class="muted">
              같은 선수·운동·촬영 방향·측정 버전·모델 설정의 기록입니다.
              촬영 구도와 중량까지 같다는 의미는 아닙니다.
            </p>
          `,
          "bars"
        );
      }

      $("#rp-graphs").innerHTML = html;
      applyVisibility();
    }

    function showResearch() {
      const papers = papersFor(record);

      $("#rp-research").innerHTML = section("논문과 비교하기 · 참고 자료", `
        <p class="muted">
          논문은 비교 자료로만 제공합니다.
          개인의 정상 각도 판정이나 육각형 계산에 사용하지 않습니다.
        </p>
        ${
          papers.length
            ? `<div class="table-wrap"><table>
                <thead><tr>
                  <th>연구</th><th>연구 조건</th>
                  <th>주요 결과</th><th>비교할 때 확인</th>
                </tr></thead>
                <tbody>
                  ${papers.map(paper => `
                    <tr>
                      <td><a href="${paper.url}" target="_blank"
                        rel="noopener noreferrer">${esc(paper.name)}</a></td>
                      <td>${esc(paper.subjects)}</td>
                      <td>${esc(paper.result)}</td>
                      <td>
                        ${esc(paper.compare)}
                        <p class="muted">${esc(paper.limit)}</p>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table></div>`
            : CM.empty("이 종목에 직접 적용할 비교 논문은 아직 없습니다.")
        }
        <p class="muted">
          연구 초록을 바탕으로 요약한 자료입니다.
          성인 연구 결과를 청소년의 정상 각도 기준으로 그대로 적용하지 않습니다.
        </p>
      `);
    }

    function applyVisibility() {
      for (const group of ["lines", "bars", "paths"]) {
        main.querySelectorAll(`[data-report-group="${group}"]`).forEach(node => {
          node.hidden = !state[group];
        });
      }
      $("#rp-photo-section").hidden = !state.photos;
    }

    function photoCard(image, title, time) {
      return `
        <figure style="margin:0">
          <img src="${esc(image)}" alt="${esc(title)}"
            style="width:100%;border-radius:10px">
          <figcaption>${esc(title)} · ${fmt(time, 2)}초</figcaption>
        </figure>
      `;
    }

    function photoTargets() {
      if (reps.length) {
        return reps.slice(0, 4).flatMap((rep, index) => {
          const bottom =
            finite(rep.bottom) &&
            rep.bottom >= rep.start &&
            rep.bottom <= rep.end;

          return [
            { t: rep.start, title: `${index + 1}회 시작` },
            {
              t: bottom ? rep.bottom : (rep.start + rep.end) / 2,
              title: `${index + 1}회 ${bottom ? "최소 각도" : "시간상 중간"}`
            },
            { t: rep.end, title: `${index + 1}회 종료` }
          ];
        });
      }

      if (!samples.length) return [];
      const count = lastTime > firstTime ? 6 : 1;

      return Array.from({ length: count }, (_, index) => ({
        t: count === 1 ? firstTime :
          firstTime + (lastTime - firstTime) * index / (count - 1),
        title: `기록 구간 ${index + 1}`
      }));
    }

    function videoEvent(video, eventName, action) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("영상 프레임 준비 시간이 초과되었습니다.")),
          12000
        );

        function finish(error) {
          clearTimeout(timer);
          video.removeEventListener(eventName, done);
          video.removeEventListener("error", fail);
          signal.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        }

        function done() { finish(); }
        function fail() { finish(new Error("원본 영상을 읽을 수 없습니다.")); }
        function abort() { finish(new Error("리포트 화면이 닫혔습니다.")); }

        video.addEventListener(eventName, done, { once: true });
        video.addEventListener("error", fail, { once: true });
        signal.addEventListener("abort", abort, { once: true });

        try { action(); } catch (error) { finish(error); }
      });
    }

    async function generatePhotos() {
      const saved = (record.snapshots || []).filter(item =>
        typeof item.image === "string" &&
        /^data:image\/(jpeg|png|webp);base64,/i.test(item.image)
      ).slice(0, 12);

      $("#rp-photos").innerHTML = saved.map(item =>
        photoCard(item.image, "저장된 동작 사진", item.t)
      ).join("");

      if (!record.mediaId) {
        $("#rp-photo-status").textContent = saved.length
          ? "저장된 캡처를 표시합니다. 원본 영상이 없어 추가 프레임은 추출하지 않습니다."
          : "저장된 원본 영상과 캡처가 없습니다. 과거 카메라 사진은 복원할 수 없습니다.";
        return;
      }

      photoBusy = true;
      $("#rp-print").disabled = true;
      $("#rp-photo-status").textContent = "원본 영상에서 동작 사진을 추출하는 중…";

      try {
        const media = await CM.db.get("media", record.mediaId);
        if (!active) return;
        if (!(media?.blob instanceof Blob)) throw new Error("저장된 원본 영상이 없습니다.");

        photoURL = URL.createObjectURL(media.blob);
        const video = document.createElement("video");
        photoVideo = video;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.setAttribute("playsinline", "");

        await videoEvent(video, "loadeddata", () => {
          video.src = photoURL;
          video.load();
        });

        if (
          !finite(video.duration) ||
          !video.videoWidth ||
          !video.videoHeight
        ) throw new Error("영상 정보를 확인하지 못했습니다.");

        const output = document.createElement("canvas");
        const ratio = Math.min(1, 720 / video.videoWidth);
        output.width = Math.round(video.videoWidth * ratio);
        output.height = Math.round(video.videoHeight * ratio);
        const context = output.getContext("2d");

        const targets = photoTargets();
        let generatedHTML = "";

        for (let index = 0; index < targets.length; index++) {
          if (!active) return;

          const target = targets[index];
          const time = clamp(
            target.t, 0, Math.max(0, video.duration - 0.001)
          );

          if (Math.abs(video.currentTime - time) > 0.001) {
            await videoEvent(video, "seeked", () => {
              video.currentTime = time;
            });
          }

          if (!active) return;

          context.drawImage(video, 0, 0, output.width, output.height);

          generatedHTML += photoCard(
            output.toDataURL("image/jpeg", 0.82),
            target.title,
            time
          );

          $("#rp-photos").innerHTML = generatedHTML;
          $("#rp-photo-status").textContent =
            `${index + 1}/${targets.length}장 추출 중…`;

          await new Promise(resolve => setTimeout(resolve, 0));
        }

        if (active) {
          $("#rp-photo-status").textContent =
            "원본 영상에서 자동 추출한 사진입니다. 인쇄/PDF에 포함됩니다. " +
            "원본 기록의 캡처를 덮어쓰지 않습니다.";
        }
      } catch (error) {
        if (active) {
          console.warn(error);
          $("#rp-photo-status").textContent =
            "자동 추출을 완료하지 못했습니다. 현재 표시된 사진은 유지합니다.";
        }
      } finally {
        photoVideo?.pause();

        if (photoVideo) {
          photoVideo.removeAttribute("src");
          photoVideo.load();
          photoVideo = null;
        }

        if (photoURL) {
          URL.revokeObjectURL(photoURL);
          photoURL = null;
        }

        photoBusy = false;
        if (active) $("#rp-print").disabled = saving;
      }
    }

    async function saveCoach() {
      if (saving) return false;
      saving = true;
      $("#rp-save").disabled = true;
      $("#rp-print").disabled = true;

      try {
        const latest = await CM.db.get("records", record.id);
        if (!latest) throw new Error("저장된 분석 기록을 찾을 수 없습니다.");

        const updates = {};

        for (const [id, key] of Object.entries(fields)) {
          updates[key] = $(`#${id}`).value.trim();
        }

        record = {
          ...latest,
          ...updates,
          updatedAt: new Date().toISOString(),
          autoReport: {
            version: "integrated-report-v1",
            generatedAt: new Date().toISOString(),
            joint: state.joint,
            side: state.scoreSide,
            axes: automaticAxes,
            notes: automaticNotes,
            researchRole: "reference-only"
          }
        };

        await CM.db.put("records", record);
        dirty = false;
        CM.toast("코치 메모와 분석 요약을 저장했습니다.");
        return true;
      } catch (error) {
        console.error(error);
        CM.toast(error.message || "저장하지 못했습니다.");
        return false;
      } finally {
        saving = false;
        if (active) {
          $("#rp-save").disabled = false;
          $("#rp-print").disabled = photoBusy;
        }
      }
    }

    function restorePrint() {
      for (const item of printCopies) {
        item.node.style.display = item.display;
        item.copy.remove();
      }
      printCopies = [];
    }

    on("#rp-save", "click", saveCoach);
    on("#rp-csv", "click", () => CM.exportRecordCSV(record));

    on("#rp-record", "change", async event => {
      if (saving) {
        event.target.value = record.id;
        CM.toast("저장이 끝난 뒤 선택해 주세요.");
        return;
      }

      if (dirty && !window.confirm("저장하지 않은 메모를 버리고 이동할까요?")) {
        event.target.value = record.id;
        return;
      }

      CM.selectedRecord = event.target.value;
      await CM.renderReports();
    });

    on("#rp-part", "change", event => {
      state.part = event.target.value;

      if (state.part === "wrist" && state.mode === "angle") {
        state.mode = "x";
        $("#rp-mode").value = "x";
      }

      showDetail();
    });

    on("#rp-side", "change", event => {
      state.side = event.target.value;
      showDetail();
      showGraphs();
    });

    on("#rp-mode", "change", event => {
      state.mode = event.target.value;

      if (state.part === "wrist" && state.mode === "angle") {
        state.mode = "x";
        event.target.value = "x";
        CM.toast("손목은 위치 변화 그래프를 제공합니다.");
      }

      showDetail();
    });

    on("#rp-joint", "change", event => {
      state.joint = event.target.value;
      showRadarAndFeedback();
      showGraphs();
    });

    on("#rp-score-side", "change", event => {
      state.scoreSide = event.target.value;
      showRadarAndFeedback();
      showGraphs();
    });

    on("#rp-smoothing", "change", event => {
      state.smooth = event.target.value === "mean";
      showDetail();
      showGraphs();
    });

    on("#rp-threshold", "change", event => {
      state.threshold = Number(event.target.value);
      showDetail();
      showGraphs();
    });

    function setRange() {
      const start = Number($("#rp-start").value);
      const end = Number($("#rp-end").value);

      if (
        !finite(start) || !finite(end) ||
        start < firstTime || end > lastTime || end <= start
      ) {
        $("#rp-start").value = state.start;
        $("#rp-end").value = state.end;
        CM.toast("저장된 기록 안에서 시작·종료 시간을 선택하세요.");
        return;
      }

      state.start = start;
      state.end = end;
      state.time = clamp(state.time, start, end);

      $("#rp-time").min = start;
      $("#rp-time").max = end;
      $("#rp-time").value = state.time;

      showDetail();
      showGraphs();
    }

    on("#rp-start", "change", setRange);
    on("#rp-end", "change", setRange);

    on("#rp-full", "click", () => {
      state.start = firstTime;
      state.end = lastTime;
      state.time = firstTime;

      $("#rp-start").value = firstTime;
      $("#rp-end").value = lastTime;
      $("#rp-time").min = firstTime;
      $("#rp-time").max = Math.max(firstTime + 0.01, lastTime);
      $("#rp-time").value = firstTime;

      showDetail();
      showGraphs();
    });

    on("#rp-time", "input", event => {
      state.time = Number(event.target.value);
      showSkeleton();
    });

    on("#rp-time", "change", showDetail);

    for (const [id, key] of [
      ["rp-lines", "lines"],
      ["rp-bars", "bars"],
      ["rp-paths", "paths"],
      ["rp-photos-toggle", "photos"]
    ]) {
      on(`#${id}`, "change", event => {
        state[key] = event.target.checked;
        applyVisibility();
      });
    }

    on("#rp-training", "click", async () => {
      if (saving) return;
      if (dirty && !(await saveCoach())) return;

      CM.selectedAthlete = record.athleteId || "";
      CM.trainingDraft = {
        athleteId: record.athleteId || "",
        athleteName: record.athleteName || "게스트",
        sourceRecordId: record.id,
        reason: $("#rp-priorities").value.trim() ||
          automaticNotes.join("\n\n"),
        goal: $("#rp-goal").value.trim() ||
          "같은 촬영 구도와 운동 조건에서 다시 측정하고 반복별 움직임을 비교합니다."
      };

      location.hash = "training";
    });

    on("#rp-compare", "click", () => {
      location.hash = "compare";
    });

    on("#rp-print", "click", async () => {
      if (saving || photoBusy) return;
      if (dirty && !(await saveCoach())) return;

      restorePrint();

      for (const id of Object.keys(fields)) {
        const node = $(`#${id}`);
        const element = document.createElement("div");
        element.textContent = node.value || "입력 없음";
        element.style.whiteSpace = "pre-wrap";
        element.style.overflowWrap = "anywhere";
        element.style.padding = "10px 0";

        printCopies.push({
          node,
          copy: element,
          display: node.style.display
        });

        node.style.display = "none";
        node.after(element);
      }

      try {
        window.print();
      } catch (error) {
        restorePrint();
        throw error;
      }
    });

    window.addEventListener("afterprint", restorePrint, { signal });

    window.addEventListener("beforeunload", event => {
      if (!dirty && !saving) return;
      event.preventDefault();
      event.returnValue = "";
    }, { signal });

    CM.reportsCanLeave = () => {
      if (saving) {
        CM.toast("저장이 끝날 때까지 기다려 주세요.");
        return false;
      }

      return !dirty ||
        window.confirm("저장하지 않은 코치 메모를 버리고 이동할까요?");
    };

    CM.reportsCleanup = () => {
      active = false;
      restorePrint();
      controller.abort();

      if (unbindSeek) unbindSeek();
      unbindSeek = null;

      photoVideo?.pause();

      if (photoURL) {
        URL.revokeObjectURL(photoURL);
        photoURL = null;
      }

      CM.reportsCanLeave = null;
      CM.reportsCleanup = null;
    };

    unbindSeek = CM.bindChartSeek($("#rp-detail-chart"), time => {
      state.time = clamp(time, state.start, state.end);
      $("#rp-time").value = state.time;
      showDetail();
    });

    showSummary();
    showRadarAndFeedback();
    showDetail();
    showGraphs();
    showResearch();
    void generatePhotos();
  };

  CM.renderFeedback = async () => {
    await CM.renderReports();

    document.querySelector("#rp-auto-feedback")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };
})();