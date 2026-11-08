/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   compare.js

   두 분석 기록 비교
   - 영상 나란히 보기
   - 비교 시작점 정렬
   - 동시 재생 / 슬로모션
   - 좌우·관절 선택
   - 스켈레톤 표시
   - 관절 변화 그래프
   - 측정값 비교표
   - 원본 영상 다시 연결

   영상이 없어도 저장된 관절점과 그래프는 확인 가능합니다.
   다시 연결한 영상은 이 화면에서만 사용합니다.
   ========================================================= */

"use strict";

window.CM = window.CM || {};

/* ---------------------------------------------------------
   특정 시점과 가장 가까운 측정값 찾기

   측정값이 멀리 떨어져 있으면 null을 반환합니다.
   누락 구간에서 이전 자세가 계속 표시되는 것을 막습니다.
   --------------------------------------------------------- */

CM.findNearestSample = function (
  samples,
  time,
  tolerance = 0.16
) {
  if (
    !Array.isArray(samples) ||
    !samples.length ||
    !Number.isFinite(time)
  ) {
    return null;
  }

  let left = 0;
  let right = samples.length - 1;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    const current = samples[middle].t;

    if (current < time) {
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  const candidates = [];

  if (left < samples.length) {
    candidates.push(samples[left]);
  }

  if (right >= 0) {
    candidates.push(samples[right]);
  }

  let nearest = null;
  let distance = Infinity;

  for (const sample of candidates) {
    const difference = Math.abs(sample.t - time);

    if (difference < distance) {
      distance = difference;
      nearest = sample;
    }
  }

  return distance <= tolerance ? nearest : null;
};

/* ---------------------------------------------------------
   비교 화면
   --------------------------------------------------------- */

CM.renderCompare = async function () {
  const [records, athletes] = await Promise.all([
    CM.db.all("records"),
    CM.db.all("athletes")
  ]);

  records.sort((a, b) => {
    return (
      (Date.parse(b.createdAt) || 0) -
      (Date.parse(a.createdAt) || 0)
    );
  });

  const main = document.querySelector("#main");

  if (!records.length) {
    main.innerHTML =
      CM.heading("비교 분석", "MOVEMENT COMPARISON") +
      `
        <section class="panel">
          ${CM.empty("저장된 분석 기록이 없습니다.")}

          <div class="row" style="justify-content:center">
            <a href="#analysis">자세분석 시작 →</a>
          </div>
        </section>
      `;

    return;
  }

  const viewNames = {
    side: "측면",
    front: "정면",
    back: "후면"
  };

  function recordName(record) {
    return [
      record.athleteName || "임시 분석",
      CM.athleteRecordExercise(record),
      CM.athleteRecordDate(record),
      viewNames[record.view] || "방향 미지정"
    ].join(" · ");
  }

  function panelHTML(side, title) {
    return `
      <section class="panel">
        <h2>${title}</h2>

        <label>
          비교할 기록
          <select id="cp-record-${side}"></select>
        </label>

        <p
          id="cp-meta-${side}"
          class="notice"
          style="min-height:38px"
        ></p>

        <div
          id="cp-stage-${side}"
          class="stage"
          style="min-height:0;aspect-ratio:16/9"
        >
          <video
            id="cp-video-${side}"
            playsinline
            muted
            preload="metadata"
            style="width:100%;height:100%;object-fit:contain"
          ></video>

          <canvas
            id="cp-canvas-${side}"
            style="pointer-events:none"
          ></canvas>
        </div>

        <p
          id="cp-video-status-${side}"
          class="notice"
          role="status"
        >
          기록을 선택하세요.
        </p>

        <div class="form-grid">
          <label>
            비교 시작점 · 원본 영상 초
            <input
              id="cp-offset-${side}"
              type="number"
              min="0"
              step="0.1"
              value="0"
            >
          </label>

          <label>
            원본 영상 다시 연결
            <input
              id="cp-file-${side}"
              type="file"
              accept="video/*"
            >
          </label>
        </div>

        <p class="notice">
          저장 당시의 원본 파일을 연결하세요.
          다른 영상이나 편집본은 관절점과 맞지 않을 수 있습니다.
        </p>
      </section>
    `;
  }

  main.innerHTML =
    CM.heading(
      "비교 분석",
      "MOVEMENT COMPARISON",
      `<span class="badge">기록 A · 기록 B</span>`
    ) +
    `
      <section class="panel">
        <div class="row">
          <label style="min-width:180px;flex:1">
            선수 필터
            <select id="cp-athlete">
              <option value="all">전체 기록</option>
              <option value="guest">임시 분석</option>

              ${athletes.map(athlete => `
                <option value="${CM.escape(athlete.id)}">
                  ${CM.escape(athlete.name)}
                </option>
              `).join("")}
            </select>
          </label>

          <label style="min-width:150px;flex:1">
            비교 관절
            <select id="cp-joint">
              ${Object.entries(CM.poseJoints).map(
                ([key, joint]) => `
                  <option
                    value="${key}"
                    ${key === "knee" ? "selected" : ""}
                  >
                    ${joint.name}
                  </option>
                `
              ).join("")}
            </select>
          </label>

          <label style="min-width:130px;flex:1">
            신체 좌우
            <select id="cp-side">
              <option value="both">양쪽</option>
              <option value="left">왼쪽</option>
              <option value="right">오른쪽</option>
            </select>
          </label>

          <label class="row">
            <input id="cp-skeleton" type="checkbox" checked>
            스켈레톤
          </label>

          <label class="row">
            <input id="cp-angles" type="checkbox" checked>
            각도
          </label>
        </div>

        <p id="cp-warning" class="warn" style="margin-top:16px"></p>
      </section>

      <div class="grid g2">
        ${panelHTML("a", "기록 A")}
        ${panelHTML("b", "기록 B")}
      </div>

      <section class="panel">
        <div class="row">
          <button id="cp-play" class="primary">
            동시 재생
          </button>

          <button id="cp-pause">
            일시정지
          </button>

          <button id="cp-start">
            비교 시작점으로
          </button>

          <button id="cp-back">
            −0.1초
          </button>

          <button id="cp-forward">
            +0.1초
          </button>

          <select
            id="cp-speed"
            aria-label="비교 재생 속도"
            style="width:110px"
          >
            <option value="0.25">0.25배</option>
            <option value="0.5">0.5배</option>
            <option value="1" selected>1배</option>
          </select>

          <span id="cp-clock" class="muted">0.0초</span>
        </div>

        <input
          id="cp-seek"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value="0"
          aria-label="비교 시간 이동"
          style="margin-top:16px"
        >

        <p class="notice">
          비교 시간 0초는 각 기록에서 지정한 시작점입니다.
          같은 동작 단계가 시작되는 시점을 맞춰 주세요.
        </p>
      </section>

      <section class="panel">
        <div class="row spread">
          <h2>관절 각도 비교</h2>

          <button id="cp-export" class="small">
            그래프 SVG 저장
          </button>
        </div>

        <div id="cp-chart"></div>

        <p class="notice">
          색상은 기록 A·B를 구분합니다.
          왼쪽은 실선, 오른쪽은 점선입니다.
          그래프를 누르면 해당 비교 시점으로 이동합니다.
        </p>
      </section>

      <section class="panel">
        <h2>측정값 비교</h2>

        <div id="cp-stats"></div>

        <p class="notice">
          아래 수치는 두 기록의 공통 비교 시간 구간에서 계산합니다.
          차이가 크다는 사실만으로 개선·악화 또는 근력 차이를 판단하지 않습니다.
        </p>
      </section>
    `;

  const $ = id => document.getElementById(id);

  function makeSlot(side) {
    return {
      side,
      record: null,
      samples: [],
      offset: 0,
      token: 0,
      url: null,
      videoReady: false,
      overlayCompatible: true,
      video: $("cp-video-" + side),
      canvas: $("cp-canvas-" + side),
      stage: $("cp-stage-" + side)
    };
  }

  const state = {
    active: true,
    playing: false,
    starting: false,
    time: 0,
    duration: 0,
    speed: 1,
    lastFrame: 0,
    frameId: null,
    a: makeSlot("a"),
    b: makeSlot("b")
  };

  function slots() {
    return [state.a, state.b];
  }

  function sides() {
    return $("cp-side").value === "both"
      ? ["left", "right"]
      : [$("cp-side").value];
  }

  function slotStatus(slot, message) {
    if (!state.active) return;

    $("cp-video-status-" + slot.side).textContent =
      message;
  }

  function pause() {
    state.playing = false;

    for (const slot of slots()) {
      slot.video.pause();
    }

    $("cp-play").textContent = "동시 재생";
  }

  function releaseVideo(slot) {
    slot.videoReady = false;

    slot.video.pause();
    slot.video.removeAttribute("src");
    slot.video.load();

    if (slot.url) {
      URL.revokeObjectURL(slot.url);
      slot.url = null;
    }
  }

  function samplesEnd(slot) {
    return slot.samples.length
      ? slot.samples[slot.samples.length - 1].t
      : 0;
  }

  function updateDuration() {
    pause();

    if (
      !state.a.samples.length ||
      !state.b.samples.length
    ) {
      state.duration = 0;
    } else {
      state.duration = Math.max(
        0,
        Math.min(
          samplesEnd(state.a) - state.a.offset,
          samplesEnd(state.b) - state.b.offset
        )
      );
    }

    state.time = CM.clamp(
      state.time,
      0,
      state.duration
    );

    $("cp-seek").max = String(
      Math.max(0.01, state.duration)
    );

    $("cp-seek").disabled = state.duration <= 0;
    $("cp-play").disabled = state.duration <= 0;

    alignVideos(true);
    drawAll();
    drawCharts();
    drawStats();
    updateWarning();
  }

  function updateWarning() {
    const a = state.a.record;
    const b = state.b.record;

    if (!a || !b) {
      $("cp-warning").textContent =
        "비교할 기록 A와 B를 선택하세요.";
      return;
    }

    const messages = [];

    if (a.id === b.id) {
      messages.push("같은 기록을 두 번 선택했습니다.");
    }

    if (
      (a.exerciseId || a.exercise?.id) !==
      (b.exerciseId || b.exercise?.id)
    ) {
      messages.push("서로 다른 운동입니다.");
    }

    if (a.view !== b.view) {
      messages.push(
        "촬영 방향이 달라 각도 수치를 직접 비교하기 어렵습니다."
      );
    }

    if (
      a.measurementVersion !== b.measurementVersion ||
      a.angleDefinition !== b.angleDefinition
    ) {
      messages.push(
        "측정 버전 또는 각도 정의가 다릅니다."
      );
    }

    if (a.athleteId !== b.athleteId) {
      messages.push("서로 다른 선수의 기록입니다.");
    }

    if (
      Number.isFinite(a.weight) &&
      Number.isFinite(b.weight) &&
      a.weight !== b.weight
    ) {
      messages.push("운동 중량이 다릅니다.");
    }

    if (state.duration <= 0) {
      messages.push(
        "시작점 이후에 공통으로 비교할 측정 구간이 없습니다."
      );
    }

    $("cp-warning").textContent = messages.length
      ? messages.join(" ")
      : "같은 운동·촬영 방향의 기록입니다. 카메라 위치와 동작 시작점도 확인해 주세요.";
  }

  function assignVideo(slot, blob) {
    releaseVideo(slot);

    slot.overlayCompatible = true;
    slot.url = URL.createObjectURL(blob);
    slot.video.src = slot.url;
    slot.video.load();

    slotStatus(slot, "원본 영상을 불러오는 중입니다.");
  }

  async function loadSlot(slot, id) {
    pause();

    const token = ++slot.token;

    releaseVideo(slot);

    slot.record = records.find(record => record.id === id) || null;

    slot.samples = (slot.record?.samples || [])
      .filter(sample => Number.isFinite(sample.t))
      .slice()
      .sort((a, b) => a.t - b.t);

    slot.offset = slot.samples[0]?.t || 0;

    $("cp-offset-" + slot.side).value =
      String(slot.offset);

    $("cp-file-" + slot.side).value = "";

    if (!slot.record) {
      $("cp-meta-" + slot.side).textContent =
        "선택된 기록이 없습니다.";

      slotStatus(slot, "기록을 선택하세요.");
      updateDuration();

      return;
    }

    const record = slot.record;

    slot.canvas.width =
      Number.isFinite(record.width) && record.width > 0
        ? record.width
        : 1280;

    slot.canvas.height =
      Number.isFinite(record.height) && record.height > 0
        ? record.height
        : 720;

    slot.stage.style.aspectRatio =
      slot.canvas.width + " / " + slot.canvas.height;

    slot.overlayCompatible = true;

    $("cp-meta-" + slot.side).textContent =
      recordName(record);

    slotStatus(
      slot,
      "원본 영상이 없으면 저장된 관절점으로 표시합니다."
    );

    updateDuration();

    if (!record.mediaId) {
      return;
    }

    try {
      const media = await CM.db.get(
        "media",
        record.mediaId
      );

      if (
        !state.active ||
        slot.token !== token
      ) {
        return;
      }

      if (media?.blob instanceof Blob) {
        assignVideo(slot, media.blob);
      } else {
        slotStatus(
          slot,
          "저장된 원본을 찾지 못했습니다. 원본 영상을 다시 연결할 수 있습니다."
        );
      }
    } catch (error) {
      if (state.active && slot.token === token) {
        slotStatus(
          slot,
          "원본 불러오기 실패: " + error.message
        );
      }
    }
  }

  function selectedSample(slot) {
    return CM.findNearestSample(
      slot.samples,
      slot.offset + state.time
    );
  }

  function drawSlot(slot) {
    const canvas = slot.canvas;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sample = selectedSample(slot);

    if (!slot.record) return;

    const videoLoaded = slot.videoReady;

    if (videoLoaded && !slot.overlayCompatible) {
      return;
    }

    const points = sample?.points || [];
    const joint = $("cp-joint").value;

    ctx.lineWidth = Math.max(
      2,
      canvas.width / 400
    );

    ctx.font =
      Math.max(16, canvas.width / 55) +
      "px sans-serif";

    if (!sample) {
      if (!videoLoaded) {
        ctx.fillStyle = "#8da7b5";

        ctx.fillText(
          "이 시점에 측정값이 없습니다.",
          canvas.width * 0.08,
          canvas.height * 0.5
        );
      }

      return;
    }

    const edges = [
      [11, 13],
      [13, 15],
      [11, 23],
      [23, 25],
      [25, 27],
      [27, 29],
      [29, 31],
      [12, 14],
      [14, 16],
      [12, 24],
      [24, 26],
      [26, 28],
      [28, 30],
      [30, 32],
      [11, 12],
      [23, 24]
    ];

    const visibleIds = new Set();

    if (sides().includes("left")) {
      [11, 13, 15, 23, 25, 27, 29, 31].forEach(id => {
        visibleIds.add(id);
      });
    }

    if (sides().includes("right")) {
      [12, 14, 16, 24, 26, 28, 30, 32].forEach(id => {
        visibleIds.add(id);
      });
    }

    if ($("cp-skeleton").checked) {
      for (const [first, second] of edges) {
        if (
          !visibleIds.has(first) ||
          !visibleIds.has(second)
        ) {
          continue;
        }

        const a = points[first];
        const b = points[second];

        if (
          !CM.posePointValid(a) ||
          !CM.posePointValid(b)
        ) {
          continue;
        }

        ctx.strokeStyle = slot.side === "a"
          ? "#50daf2"
          : "#e691c0";

        ctx.beginPath();
        ctx.moveTo(
          a.x * canvas.width,
          a.y * canvas.height
        );

        ctx.lineTo(
          b.x * canvas.width,
          b.y * canvas.height
        );

        ctx.stroke();
      }

      for (const id of visibleIds) {
        const point = points[id];

        if (!CM.posePointValid(point)) continue;

        ctx.beginPath();

        ctx.arc(
          point.x * canvas.width,
          point.y * canvas.height,
          Math.max(3, canvas.width / 240),
          0,
          Math.PI * 2
        );

        ctx.fillStyle = point.manual
          ? "#e5c87b"
          : "#eafaff";

        ctx.fill();
      }
    }

    if ($("cp-angles").checked) {
      for (const side of sides()) {
        const ids = CM.poseJoints[joint][side];
        const center = points[ids[1]];
        const value = sample.angles?.[side + "_" + joint];

        if (
          !CM.posePointValid(center) ||
          !Number.isFinite(value)
        ) {
          continue;
        }

        const text =
          (side === "left" ? "L " : "R ") +
          value.toFixed(1) +
          "°";

        const x = center.x * canvas.width;
        const y = center.y * canvas.height;

        const textWidth = ctx.measureText(text).width;

        ctx.fillStyle = "#07131ee6";

        ctx.fillRect(
          x + 5,
          y - 27,
          textWidth + 12,
          30
        );

        ctx.fillStyle = slot.side === "a"
          ? "#50daf2"
          : "#e691c0";

        ctx.fillText(text, x + 11, y - 5);
      }
    }

    if (!videoLoaded) {
      ctx.fillStyle = "#8da7b5";

      ctx.fillText(
        "원본 영상 없음 · 저장된 관절점",
        15,
        30
      );
    }
  }

  function drawAll() {
    if (!state.active) return;

    drawSlot(state.a);
    drawSlot(state.b);

    $("cp-seek").value = String(state.time);

    $("cp-clock").textContent =
      CM.fmt(state.time) +
      " / " +
      CM.fmt(state.duration) +
      "초";
  }

  function comparisonSamples(slot) {
    return slot.samples.filter(sample => {
      const time = sample.t - slot.offset;

      return time >= 0 && time <= state.duration;
    });
  }

  function drawCharts() {
    const joint = $("cp-joint").value;
    const series = [];

    for (const slot of slots()) {
      if (!slot.record) continue;

      for (const side of sides()) {
        series.push({
          name:
            "기록 " + slot.side.toUpperCase() +
            " · " +
            (side === "left" ? "왼쪽 " : "오른쪽 ") +
            CM.poseJoints[joint].name,

          color: slot.side === "a"
            ? "#50daf2"
            : "#e691c0",

          dash: side === "right",

          data: comparisonSamples(slot).map(sample => ({
            x: sample.t - slot.offset,
            y: sample.angles?.[side + "_" + joint] ?? null
          }))
        });
      }
    }

    $("cp-chart").innerHTML = CM.lineChart(
      series,
      {
        min: 0,
        max: 180,
        xMin: 0,
        xMax: Math.max(0.1, state.duration),
        unit: "°",
        title: "기록 A와 B의 관절 각도 비교"
      }
    );
  }

  function drawStats() {
    const joint = $("cp-joint").value;
    const rows = [];

    for (const side of sides()) {
      const key = side + "_" + joint;

      const a = CM.stats(
        comparisonSamples(state.a).map(sample => {
          return sample.angles?.[key];
        })
      );

      const b = CM.stats(
        comparisonSamples(state.b).map(sample => {
          return sample.angles?.[key];
        })
      );

      for (const [field, label] of [
        ["min", "최소"],
        ["max", "최대"],
        ["mean", "평균"],
        ["range", "변화 범위"]
      ]) {
        const difference =
          Number.isFinite(a[field]) &&
          Number.isFinite(b[field])
            ? b[field] - a[field]
            : null;

        rows.push(`
          <tr>
            <td>
              ${side === "left" ? "왼쪽" : "오른쪽"}
              ${CM.poseJoints[joint].name}
            </td>

            <td>${label}</td>

            <td>${CM.fmt(a[field])}°</td>
            <td>${CM.fmt(b[field])}°</td>

            <td>
              ${
                Number.isFinite(difference)
                  ? (difference > 0 ? "+" : "") +
                    CM.fmt(difference) + "°"
                  : "—"
              }
            </td>
          </tr>
        `);
      }
    }

    $("cp-stats").innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">관절</th>
              <th scope="col">항목</th>
              <th scope="col">기록 A</th>
              <th scope="col">기록 B</th>
              <th scope="col">B − A</th>
            </tr>
          </thead>

          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
    `;
  }

  function alignVideos(force = false) {
    for (const slot of slots()) {
      if (!slot.videoReady) continue;

      const target = slot.offset + state.time;
      const video = slot.video;

      if (
        !Number.isFinite(video.duration) ||
        target < 0 ||
        target >= video.duration
      ) {
        video.pause();

        slotStatus(
          slot,
          "이 비교 시점은 연결된 영상 범위를 벗어납니다."
        );

        continue;
      }

      if (
        !video.seeking &&
        (
          force ||
          Math.abs(video.currentTime - target) > 0.18
        )
      ) {
        video.currentTime = target;
      }
    }
  }

  function seekComparison(time) {
    pause();

    state.time = CM.clamp(
      time,
      0,
      state.duration
    );

    alignVideos(true);
    drawAll();
  }

  async function startPlayback() {
    if (
      state.starting ||
      state.playing ||
      state.duration <= 0
    ) {
      return;
    }

    if (state.time >= state.duration) {
      state.time = 0;
    }

    state.starting = true;

    try {
      alignVideos(true);

      const attempts = slots()
        .filter(slot => {
          return (
            slot.videoReady &&
            slot.offset + state.time < slot.video.duration
          );
        })
        .map(async slot => {
          slot.video.playbackRate = state.speed;
          await slot.video.play();
        });

      const results = await Promise.allSettled(attempts);

      if (!state.active) {
        slots().forEach(slot => slot.video.pause());
        return;
      }

      if (results.some(result => result.status === "rejected")) {
        slots().forEach(slot => slot.video.pause());

        CM.toast(
          "일부 영상을 재생하지 못했습니다. 파일을 확인해 주세요."
        );

        return;
      }

      state.playing = true;
      state.lastFrame = performance.now();

      $("cp-play").textContent = "재생 중";
    } finally {
      state.starting = false;
    }
  }

  function animation(now) {
    if (!state.active) return;

    state.frameId = requestAnimationFrame(animation);

    if (!state.playing) return;

    const elapsed = (now - state.lastFrame) / 1000;
    state.lastFrame = now;

    if (document.hidden) {
      pause();
      return;
    }

    state.time = Math.min(
      state.duration,
      state.time + elapsed * state.speed
    );

    alignVideos(false);
    drawAll();

    if (state.time >= state.duration) {
      pause();
    }
  }

  function filteredRecords() {
    const athlete = $("cp-athlete").value;

    if (athlete === "all") return records;

    if (athlete === "guest") {
      return records.filter(record => !record.athleteId);
    }

    return records.filter(record => {
      return record.athleteId === athlete;
    });
  }

  async function populateSelections() {
    const filtered = filteredRecords();

    const options = filtered.map(record => `
      <option value="${CM.escape(record.id)}">
        ${CM.escape(recordName(record))}
      </option>
    `).join("");

    for (const side of ["a", "b"]) {
      $("cp-record-" + side).innerHTML =
        options || '<option value="">기록 없음</option>';
    }

    if (filtered.length) {
      $("cp-record-a").value =
        filtered[Math.min(1, filtered.length - 1)].id;

      $("cp-record-b").value = filtered[0].id;
    }

    await Promise.all([
      loadSlot(state.a, $("cp-record-a").value),
      loadSlot(state.b, $("cp-record-b").value)
    ]);
  }

  function safe(handler) {
    return async function (event) {
      try {
        await handler(event);
      } catch (error) {
        if (state.active) {
          CM.toast(error.message || "비교 작업에 실패했습니다.");
        }
      }
    };
  }

  /* -------------------------------------------------------
     영상 이벤트
     ------------------------------------------------------- */

  for (const slot of slots()) {
    slot.video.onloadedmetadata = function () {
      if (!state.active) return;

      slot.videoReady = true;

      const videoRatio =
        slot.video.videoWidth / slot.video.videoHeight;

      const recordRatio =
        slot.canvas.width / slot.canvas.height;

      slot.overlayCompatible =
        Number.isFinite(videoRatio) &&
        Math.abs(videoRatio - recordRatio) / recordRatio < 0.02;

      slotStatus(
        slot,
        slot.overlayCompatible
          ? "영상 연결 완료. 저장 당시의 원본인지 확인하세요."
          : "영상 비율이 기록과 다릅니다. 잘못 겹쳐 보이지 않도록 스켈레톤 표시를 중지했습니다."
      );

      alignVideos(true);
      drawSlot(slot);
    };

    slot.video.onerror = function () {
      if (!state.active) return;

      slot.videoReady = false;
      pause();

      slotStatus(
        slot,
        "영상 재생 실패. MP4(H.264) 원본 파일을 확인하세요."
      );

      drawSlot(slot);
    };

    $("cp-record-" + slot.side).onchange = safe(
      async function (event) {
        state.time = 0;
        await loadSlot(slot, event.target.value);
      }
    );

    $("cp-offset-" + slot.side).onchange = function () {
      const input = $("cp-offset-" + slot.side);
      const value = Number(input.value);

      if (!Number.isFinite(value) || value < 0) {
        input.value = String(slot.offset);

        CM.toast("시작점은 0 이상의 초 단위로 입력하세요.");
        return;
      }

      slot.offset = value;
      state.time = 0;

      updateDuration();
    };

    $("cp-file-" + slot.side).onchange = safe(
      async function (event) {
        const file = event.target.files?.[0];

        if (!file) return;

        if (!slot.record) {
          throw new Error("분석 기록을 먼저 선택해 주세요.");
        }

        pause();

        // 진행 중인 이전 원본 조회 결과가 덮어쓰지 않도록 합니다.
        slot.token += 1;

        assignVideo(slot, file);

        event.target.value = "";
      }
    );
  }

  /* -------------------------------------------------------
     공통 조작
     ------------------------------------------------------- */

  $("cp-athlete").onchange = safe(populateSelections);

  $("cp-joint").onchange = function () {
    drawAll();
    drawCharts();
    drawStats();
  };

  $("cp-side").onchange = function () {
    drawAll();
    drawCharts();
    drawStats();
  };

  $("cp-skeleton").onchange = drawAll;
  $("cp-angles").onchange = drawAll;

  $("cp-play").onclick = safe(startPlayback);
  $("cp-pause").onclick = pause;

  $("cp-start").onclick = function () {
    seekComparison(0);
  };

  $("cp-back").onclick = function () {
    seekComparison(state.time - 0.1);
  };

  $("cp-forward").onclick = function () {
    seekComparison(state.time + 0.1);
  };

  $("cp-seek").oninput = function (event) {
    seekComparison(Number(event.target.value));
  };

  $("cp-speed").onchange = function () {
    state.speed = Number($("cp-speed").value);

    for (const slot of slots()) {
      slot.video.playbackRate = state.speed;
    }

    state.lastFrame = performance.now();
  };

  $("cp-export").onclick = safe(function () {
    CM.exportChartSVG(
      $("cp-chart"),
      "codeon-comparison.svg"
    );
  });

  const unbindChart = CM.bindChartSeek(
    $("cp-chart"),
    seekComparison
  );

  function onVisibilityChange() {
    if (document.hidden) pause();
  }

  document.addEventListener(
    "visibilitychange",
    onVisibilityChange
  );

  /* app.js가 비교 화면을 떠날 때 호출합니다. */
  CM.compareCleanup = function () {
    state.active = false;
    state.playing = false;

    cancelAnimationFrame(state.frameId);

    for (const slot of slots()) {
      slot.token += 1;
      releaseVideo(slot);
    }

    unbindChart();

    document.removeEventListener(
      "visibilitychange",
      onVisibilityChange
    );

    CM.compareCleanup = null;
  };

  if (
    CM.selectedAthlete &&
    athletes.some(athlete => athlete.id === CM.selectedAthlete)
  ) {
    $("cp-athlete").value = CM.selectedAthlete;
  }

  await populateSelections();

  if (state.active) {
    state.frameId = requestAnimationFrame(animation);
  }
};