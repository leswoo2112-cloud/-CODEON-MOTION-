/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   analysis.js

   카메라 / 영상 업로드 / 2D 관절 인식
   스켈레톤 / 각도 / 기준선 / 좌우 선택
   그래프 / 구간 반복 / 수동 보정 / 장면 저장
   반복 구간 / 분석 저장

   자동 인식: MediaPipe Pose Landmarker
   바벨: 현재 프레임의 위치를 직접 표시하는 수동 방식

   측정값은 2D 영상 좌표 기준입니다.
   실제 3D 각도·무게중심·관절 부하가 아닙니다.
   ========================================================= */

"use strict";

window.CM = window.CM || {};

/* ---------------------------------------------------------
   관절 정의
   각도는 A-B-C의 내부각입니다.
   --------------------------------------------------------- */

CM.poseJoints = {
  shoulder: {
    name: "어깨",
    left: [23, 11, 13],
    right: [24, 12, 14]
  },

  elbow: {
    name: "팔꿈치",
    left: [11, 13, 15],
    right: [12, 14, 16]
  },

  hip: {
    name: "고관절",
    left: [11, 23, 25],
    right: [12, 24, 26]
  },

  knee: {
    name: "무릎",
    left: [23, 25, 27],
    right: [24, 26, 28]
  },

  ankle: {
    name: "발목",
    left: [25, 27, 31],
    right: [26, 28, 32]
  }
};

CM.posePointNames = {
  11: "왼쪽 어깨",
  12: "오른쪽 어깨",
  13: "왼쪽 팔꿈치",
  14: "오른쪽 팔꿈치",
  15: "왼쪽 손목",
  16: "오른쪽 손목",
  23: "왼쪽 고관절",
  24: "오른쪽 고관절",
  25: "왼쪽 무릎",
  26: "오른쪽 무릎",
  27: "왼쪽 발목",
  28: "오른쪽 발목",
  29: "왼쪽 뒤꿈치",
  30: "오른쪽 뒤꿈치",
  31: "왼쪽 발끝",
  32: "오른쪽 발끝"
};

/* ---------------------------------------------------------
   측정 계산
   정규화 좌표를 영상 픽셀 비율로 환산합니다.
   --------------------------------------------------------- */

CM.posePointValid = function (point) {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (
      point.manual ||
      (point.visibility ?? 0) >= 0.55
    )
  );
};

CM.angle2D = function (a, b, c, width, height) {
  if (![a, b, c].every(CM.posePointValid)) {
    return null;
  }

  const ax = (a.x - b.x) * width;
  const ay = (a.y - b.y) * height;
  const cx = (c.x - b.x) * width;
  const cy = (c.y - b.y) * height;

  const lengthA = Math.hypot(ax, ay);
  const lengthC = Math.hypot(cx, cy);

  if (lengthA < 0.001 || lengthC < 0.001) {
    return null;
  }

  const cosine = CM.clamp(
    (ax * cx + ay * cy) / (lengthA * lengthC),
    -1,
    1
  );

  return Math.acos(cosine) * 180 / Math.PI;
};

CM.measurePose = function (points, width, height) {
  const angles = {};

  for (const [joint, definition] of Object.entries(
    CM.poseJoints
  )) {
    for (const side of ["left", "right"]) {
      const ids = definition[side];

      angles[side + "_" + joint] = CM.angle2D(
        points[ids[0]],
        points[ids[1]],
        points[ids[2]],
        width,
        height
      );
    }
  }

  const metrics = {
    left_trunk: null,
    right_trunk: null,
    shoulderTilt: null,
    hipTilt: null,
    pelvisX: null,
    pelvisY: null,
    left_kneeToe: null,
    right_kneeToe: null
  };

  for (const [side, shoulder, hip, knee, toe] of [
    ["left", 11, 23, 25, 31],
    ["right", 12, 24, 26, 32]
  ]) {
    if (
      CM.posePointValid(points[shoulder]) &&
      CM.posePointValid(points[hip])
    ) {
      const dx =
        (points[shoulder].x - points[hip].x) * width;

      const dy =
        (points[hip].y - points[shoulder].y) * height;

      metrics[side + "_trunk"] =
        Math.atan2(Math.abs(dx), dy) * 180 / Math.PI;
    }

    if (
      CM.posePointValid(points[knee]) &&
      CM.posePointValid(points[toe])
    ) {
      metrics[side + "_kneeToe"] =
        (points[knee].x - points[toe].x) * width;
    }
  }

  function lineTilt(first, second) {
    if (
      !CM.posePointValid(points[first]) ||
      !CM.posePointValid(points[second])
    ) {
      return null;
    }

    const dx =
      (points[second].x - points[first].x) * width;

    const dy =
      (points[second].y - points[first].y) * height;

    let angle = Math.atan2(dy, dx) * 180 / Math.PI;

    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;

    return angle;
  }

  metrics.shoulderTilt = lineTilt(11, 12);
  metrics.hipTilt = lineTilt(23, 24);

  if (
    CM.posePointValid(points[23]) &&
    CM.posePointValid(points[24])
  ) {
    metrics.pelvisX =
      (points[23].x + points[24].x) * 50;

    metrics.pelvisY =
      (points[23].y + points[24].y) * 50;
  }

  return { angles, metrics };
};

/* ---------------------------------------------------------
   설정형 반복 구간 검출

   높은 각도 → 낮은 각도 → 높은 각도
   측정 누락이 길면 진행 중인 반복을 취소합니다.
   --------------------------------------------------------- */

CM.detectRepetitions = function (
  samples,
  {
    key = "left_knee",
    low = 100,
    high = 155,
    minDuration = 0.5,
    maxGap = 0.8
  } = {}
) {
  if (
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    low >= high
  ) {
    return [];
  }

  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const repetitions = [];

  let state = "waiting";
  let start = null;
  let bottom = null;
  let minimum = Infinity;
  let lastValidTime = null;

  for (const sample of ordered) {
    const value = sample.angles?.[key];

    if (!Number.isFinite(value)) {
      continue;
    }

    if (
      lastValidTime !== null &&
      sample.t - lastValidTime > maxGap
    ) {
      state = "waiting";
      start = null;
      bottom = null;
      minimum = Infinity;
    }

    lastValidTime = sample.t;

    if (state === "waiting") {
      if (value >= high) {
        state = "ready";
        start = sample.t;
      }

      continue;
    }

    if (state === "ready") {
      if (value >= high) {
        start = sample.t;
      }

      if (value <= low) {
        state = "moving";
        bottom = sample.t;
        minimum = value;
      }

      continue;
    }

    if (value < minimum) {
      minimum = value;
      bottom = sample.t;
    }

    if (value >= high) {
      if (sample.t - start >= minDuration) {
        repetitions.push({
          id: CM.uid(),
          start,
          bottom,
          end: sample.t,
          duration: sample.t - start,
          downTime: bottom - start,
          upTime: sample.t - bottom,
          minAngle: minimum,
          source: "experimental-auto",
          key
        });
      }

      state = "ready";
      start = sample.t;
      bottom = null;
      minimum = Infinity;
    }
  }

  return repetitions;
};

/* ---------------------------------------------------------
   분석 화면
   --------------------------------------------------------- */

CM.renderAnalysis = async function () {
  if (typeof CM.loadExercises === "function") {
    await CM.loadExercises();
  }

  const athleteOptions = await CM.athleteOptions();
  const selectedExercise = CM.exerciseById(
    CM.selectedExercise
  );

  const main = document.querySelector("#main");

  main.innerHTML =
    CM.heading(
      "자세 분석",
      "MOTION ANALYSIS",
      `<span class="badge">2D 영상 좌표 분석</span>`
    ) +
    `
      <div class="analysis-layout">
        <section class="panel stack">
          <h2>분석 설정</h2>

          <label>
            선수
            <select id="an-athlete">
              ${athleteOptions}
            </select>
          </label>

          <label>
            운동
            <select id="an-exercise">
              ${CM.categories.map(category => `
                <optgroup label="${category}">
                  ${CM.exercises
                    .filter(ex => ex.category === category)
                    .map(ex => `
                      <option
                        value="${CM.escape(ex.id)}"
                        ${ex.id === selectedExercise.id ? "selected" : ""}
                      >
                        ${CM.escape(ex.name)}
                      </option>
                    `).join("")}
                </optgroup>
              `).join("")}
            </select>
          </label>

          <label>
            촬영 방향
            <select id="an-view">
              <option value="side">측면</option>
              <option value="front">정면</option>
              <option value="back">후면</option>
            </select>
          </label>

          <p id="an-guide" class="notice"></p>

          <div class="form-grid">
            <label>
              중량 · kg
              <input
                id="an-load"
                type="number"
                min="0"
                max="1000"
                step="0.5"
                placeholder="선택"
              >
            </label>

            <label>
              목표 횟수
              <input
                id="an-target"
                type="number"
                min="1"
                max="999"
                step="1"
                value="10"
              >
            </label>
          </div>

          <label>
            카메라
            <select id="an-facing">
              <option value="environment">후면 카메라 우선</option>
              <option value="user">전면 카메라 우선</option>
            </select>
          </label>

          <button id="an-camera" class="primary">
            카메라 연결
          </button>

          <button id="an-camera-stop">
            카메라 종료
          </button>

          <label>
            영상 업로드
            <input id="an-file" type="file" accept="video/*">
          </label>

          <label class="row">
            <input id="an-keep-media" type="checkbox">
            업로드한 원본 영상을 기기에 함께 저장
          </label>

          <button id="an-model">
            자동 관절 인식 준비
          </button>

          <button id="an-scan">
            전체 영상 분석 · 10Hz
          </button>

          <button id="an-cancel-scan" disabled>
            전체 분석 중지
          </button>

          <p id="an-status" class="notice" role="status">
            영상을 업로드하거나 카메라를 연결하세요.
          </p>

          <details>
            <summary>자동 반복 설정 · 실험</summary>

            <div class="stack">
              <label>
                기준 관절
                <select id="an-rep-key">
                  ${Object.entries(CM.poseJoints).map(
                    ([key, joint]) => `
                      <option value="left_${key}">
                        왼쪽 ${joint.name}
                      </option>
                      <option value="right_${key}">
                        오른쪽 ${joint.name}
                      </option>
                    `
                  ).join("")}
                </select>
              </label>

              <label>
                낮은 각도 기준
                <input
                  id="an-low"
                  type="number"
                  min="0"
                  max="179"
                  value="100"
                >
              </label>

              <label>
                높은 각도 기준
                <input
                  id="an-high"
                  type="number"
                  min="1"
                  max="180"
                  value="155"
                >
              </label>

              <button id="an-recount">
                반복 다시 계산
              </button>

              <p class="notice">
                높은 각도 → 낮은 각도 → 높은 각도를
                한 반복으로 판단합니다.
                모든 운동에 같은 기준이 맞지는 않습니다.
              </p>
            </div>
          </details>

          <details>
            <summary>측정 정의</summary>

            <p class="notice">
              무릎: 고관절–무릎–발목 내부각<br>
              고관절: 어깨–고관절–무릎 내부각<br>
              팔꿈치: 어깨–팔꿈치–손목 내부각<br>
              어깨: 고관절–어깨–팔꿈치 내부각<br>
              발목: 무릎–발목–발끝 내부각<br>
              몸통: 영상 수직선 대비 기울기
            </p>

            <p class="notice">
              발목 값은 영상상 세 점의 각도이며
              임상적 발목 배측굴곡 측정과 동일하지 않습니다.
              좌우는 운동하는 사람의 신체 기준입니다.
            </p>
          </details>
        </section>

        <div>
          <section class="panel">
            <div id="an-stage" class="stage">
              <video
                id="an-video"
                playsinline
                muted
                preload="metadata"
              ></video>

              <canvas id="an-canvas"></canvas>

              <div id="an-empty" class="stage-empty">
                <div>
                  <h2>MOTION CAPTURE</h2>
                  <p>카메라 또는 운동 영상을 연결하세요.</p>
                </div>
              </div>
            </div>

            <div class="video-controls">
              <button id="an-back">−0.1초</button>
              <button id="an-play">재생 / 일시정지</button>
              <button id="an-forward">+0.1초</button>

              <select id="an-speed" aria-label="재생 속도">
                <option value="0.25">0.25배</option>
                <option value="0.5">0.5배</option>
                <option value="1" selected>1배</option>
                <option value="1.5">1.5배</option>
                <option value="2">2배</option>
              </select>

              <span id="an-time" class="muted">0.0s</span>
            </div>

            <input
              id="an-seek"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value="0"
              aria-label="영상 시점"
              disabled
            >

            <div class="toggles" style="margin-top:14px">
              ${[
                ["skeleton", "스켈레톤", true],
                ["points", "관절점", true],
                ["angles", "각도", true],
                ["guides", "기준선", true],
                ["trail", "궤적", false],
                ["ghost", "기준 자세", false]
              ].map(([key, name, checked]) => `
                <label>
                  <input
                    type="checkbox"
                    data-overlay="${key}"
                    ${checked ? "checked" : ""}
                  >
                  ${name}
                </label>
              `).join("")}
            </div>

            <div class="row" style="margin-top:14px">
              <select
                id="an-side"
                aria-label="신체 좌우 선택"
                style="width:130px"
              >
                <option value="both">양쪽</option>
                <option value="left">왼쪽</option>
                <option value="right">오른쪽</option>
              </select>

              <button id="an-all-joints" class="small">
                전체 선택
              </button>

              <button id="an-no-joints" class="small">
                전체 해제
              </button>

              <button id="an-reference" class="small">
                현재 자세를 기준으로
              </button>

              <button id="an-snapshot" class="small">
                장면 저장
              </button>
            </div>

            <div
              id="an-joints"
              class="toggles"
              style="margin-top:12px"
            >
              ${Object.entries(CM.poseJoints).map(
                ([key, joint]) => `
                  <label>
                    <input
                      type="checkbox"
                      data-joint="${key}"
                      ${["hip", "knee", "ankle"].includes(key) ? "checked" : ""}
                    >
                    ${joint.name}
                  </label>
                `
              ).join("")}
            </div>

            <details style="margin-top:16px">
              <summary>수동 보정·기준선·구간 설정</summary>

              <div class="stack">
                <div class="row">
                  <label>
                    편집 도구
                    <select id="an-tool">
                      <option value="view">보기</option>
                      <option value="joint">선택 관절점 보정</option>
                      <option value="bar">바벨 위치 지정</option>
                    </select>
                  </label>

                  <label>
                    보정할 관절점
                    <select id="an-edit-point">
                      ${Object.entries(CM.posePointNames).map(
                        ([id, name]) => `
                          <option value="${id}">${name}</option>
                        `
                      ).join("")}
                    </select>
                  </label>

                  <button id="an-undo">되돌리기</button>
                  <button id="an-redo">다시 실행</button>
                </div>

                <p class="notice">
                  영상을 멈춘 뒤 관절점을 선택하고
                  영상 위 위치를 누르거나 드래그하세요.
                  보정은 현재 0.1초 구간에만 적용됩니다.
                  바벨도 필요한 장면마다 직접 표시합니다.
                </p>

                <div class="form-grid">
                  <label>
                    바닥 기준선 높이 · %
                    <input
                      id="an-floor"
                      type="range"
                      min="0"
                      max="100"
                      value="90"
                    >
                  </label>

                  <label>
                    기준선 기울기 · °
                    <input
                      id="an-floor-angle"
                      type="number"
                      min="-45"
                      max="45"
                      value="0"
                    >
                  </label>
                </div>

                <div class="row">
                  <button id="an-mark-a">구간 시작 A</button>
                  <button id="an-mark-b">구간 종료 B</button>

                  <label>
                    <input id="an-loop" type="checkbox">
                    A–B 반복
                  </label>

                  <button id="an-add-rep">
                    A–B를 수동 반복으로 추가
                  </button>

                  <button id="an-clear-reps">
                    수동 반복 초기화
                  </button>
                </div>

                <p id="an-range" class="notice">
                  A — / B —
                </p>
              </div>
            </details>
          </section>

          <section class="panel">
            <div class="row spread">
              <h2>관절 각도 변화</h2>

              <span class="badge">
                표시를 꺼도 측정 기록은 유지
              </span>
            </div>

            <div id="an-metrics" class="grid g4"></div>

            <div id="an-chart" style="margin-top:18px"></div>

            <p class="notice">
              그래프를 누르면 해당 영상 시점으로 이동합니다.
              인식되지 않은 구간은 연결하지 않습니다.
            </p>
          </section>

          <section class="panel">
            <div class="row spread">
              <h2>분석 저장</h2>

              <span id="an-count" class="badge">
                측정 0개
              </span>
            </div>

            <div id="an-repetitions"></div>

            <div
              id="an-snapshots"
              class="grid g3"
              style="margin-top:16px"
            ></div>

            <label style="margin-top:16px">
              분석 메모
              <textarea
                id="an-memo"
                maxlength="3000"
                placeholder="촬영 조건이나 확인할 사항"
              ></textarea>
            </label>

            <div class="row" style="margin-top:16px">
              <button id="an-save" class="primary">
                분석 저장
              </button>

              <button id="an-report">
                저장 후 리포트
              </button>

              <button id="an-new" class="danger">
                새 분석
              </button>
            </div>

            <p class="notice">
              카메라 실시간 영상 자체는 녹화하지 않습니다.
              측정값과 저장한 장면만 보관합니다.
              업로드 영상은 원본 저장을 선택한 경우 함께 보관합니다.
            </p>
          </section>
        </div>
      </div>
    `;

  const $ = id => document.getElementById(id);

  const video = $("an-video");
  const canvas = $("an-canvas");
  const context = canvas.getContext("2d");
  const stage = $("an-stage");

  const state = {
    active: true,
    model: null,
    modelLoading: null,
    stream: null,
    file: null,
    fileUrl: null,
    samples: new Map(),
    current: null,
    reference: null,
    snapshots: [],
    manualReps: [],
    undo: [],
    redo: [],
    dragBefore: null,
    dragTime: null,
    scanning: false,
    cancelScan: false,
    saving: false,
    revision: 0,
    savedRevision: 0,
    savedId: null,
    lastTimeKey: null,
    frameId: null,
    lastGraphAt: 0,
    a: null,
    b: null,
    width: 1280,
    height: 720
  };

  function status(message) {
    if (state.active) {
      $("an-status").textContent = message;
    }
  }

  function changed() {
    state.revision += 1;
  }

  function timeKey(time) {
    return Math.round(time * 10);
  }

  function timeNow() {
    return Number.isFinite(video.currentTime)
      ? video.currentTime
      : 0;
  }

  function samplesArray() {
    return [...state.samples.values()]
      .sort((a, b) => a.t - b.t);
  }

  function exercise() {
    return CM.exerciseById($("an-exercise").value);
  }

  function selectedSides() {
    const side = $("an-side").value;

    return side === "both"
      ? ["left", "right"]
      : [side];
  }

  function selectedJoints() {
    return [...main.querySelectorAll(
      "[data-joint]:checked"
    )].map(input => input.dataset.joint);
  }

  function enabled(name) {
    return main.querySelector(
      `[data-overlay="${name}"]`
    ).checked;
  }

  function currentSample() {
    return state.samples.get(timeKey(timeNow())) || null;
  }

  function buildSample(time, points, old = null) {
    const measured = CM.measurePose(
      points,
      state.width,
      state.height
    );

    return {
      t: timeKey(time) / 10,
      points,
      angles: measured.angles,
      metrics: measured.metrics,
      manual: Boolean(
        old?.manual ||
        points.some(point => point?.manual)
      ),
      bar: old?.bar || null
    };
  }

  function putSample(sample) {
    state.samples.set(timeKey(sample.t), sample);
    state.current = sample;
    changed();
  }

  function resizeStage() {
    if (!video.videoWidth || !video.videoHeight) {
      return;
    }

    state.width = video.videoWidth;
    state.height = video.videoHeight;

    canvas.width = state.width;
    canvas.height = state.height;

    stage.style.minHeight = "0";
    stage.style.aspectRatio =
      state.width + " / " + state.height;

    video.style.height = "100%";

    $("an-empty").classList.add("hidden");

    if (!state.stream && Number.isFinite(video.duration)) {
      $("an-seek").max = String(video.duration);
      $("an-seek").disabled = false;
    }

    draw();
  }

  function line(a, b, color, dash = []) {
    if (
      !CM.posePointValid(a) ||
      !CM.posePointValid(b)
    ) {
      return;
    }

    context.strokeStyle = color;
    context.setLineDash(dash);

    context.beginPath();
    context.moveTo(a.x * canvas.width, a.y * canvas.height);
    context.lineTo(b.x * canvas.width, b.y * canvas.height);
    context.stroke();

    context.setLineDash([]);
  }

  function drawPose(sample, opacity = 1) {
    if (!sample) return;

    const points = sample.points || [];
    const used = new Set();

    context.save();
    context.globalAlpha = opacity;

    for (const side of selectedSides()) {
      const color = side === "left"
        ? "#50daf2"
        : "#e691c0";

      for (const joint of selectedJoints()) {
        const ids = CM.poseJoints[joint][side];
        const [a, b, c] = ids.map(id => points[id]);

        ids.forEach(id => used.add(id));

        if (enabled("skeleton")) {
          line(a, b, color);
          line(b, c, color);
        }

        const angle = sample.angles?.[side + "_" + joint];

        if (
          enabled("angles") &&
          Number.isFinite(angle) &&
          [a, b, c].every(CM.posePointValid)
        ) {
          const bx = b.x * canvas.width;
          const by = b.y * canvas.height;

          const start = Math.atan2(
            (a.y - b.y) * canvas.height,
            (a.x - b.x) * canvas.width
          );

          const end = Math.atan2(
            (c.y - b.y) * canvas.height,
            (c.x - b.x) * canvas.width
          );

          const delta = Math.atan2(
            Math.sin(end - start),
            Math.cos(end - start)
          );

          context.strokeStyle = color;
          context.beginPath();

          context.arc(
            bx,
            by,
            Math.max(15, canvas.width / 45),
            start,
            start + delta,
            delta < 0
          );

          context.stroke();

          const label = angle.toFixed(1) + "°";
          const textWidth = context.measureText(label).width;

          context.fillStyle = "#06121ee6";

          context.fillRect(
            bx + 10,
            by - 27,
            textWidth + 12,
            26
          );

          context.fillStyle = color;
          context.fillText(label, bx + 16, by - 8);
        }
      }
    }

    if (enabled("points")) {
      for (const id of used) {
        const point = points[id];

        if (!CM.posePointValid(point)) continue;

        context.beginPath();
        context.arc(
          point.x * canvas.width,
          point.y * canvas.height,
          Math.max(3, canvas.width / 240),
          0,
          Math.PI * 2
        );

        context.fillStyle = point.manual
          ? "#e5c87b"
          : "#eafaff";

        context.fill();
      }
    }

    context.restore();
  }

  function draw() {
    if (!state.active || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);

    context.lineWidth = Math.max(2, canvas.width / 400);
    context.font =
      Math.max(14, canvas.width / 65) + "px sans-serif";

    if (enabled("guides")) {
      const floor = Number($("an-floor").value) / 100;
      const tilt =
        Number($("an-floor-angle").value) * Math.PI / 180;

      const midY = floor * canvas.height;
      const offset = Math.tan(tilt) * canvas.width / 2;

      context.strokeStyle = "#50daf280";
      context.setLineDash([8, 8]);
      context.beginPath();

      context.moveTo(0, midY - offset);
      context.lineTo(canvas.width, midY + offset);

      context.moveTo(canvas.width / 2, 0);
      context.lineTo(canvas.width / 2, canvas.height);

      context.stroke();
      context.setLineDash([]);
    }

    if (enabled("trail")) {
      const recent = samplesArray().filter(sample => {
        return (
          sample.t <= timeNow() &&
          sample.t >= timeNow() - 3
        );
      });

      for (const side of selectedSides()) {
        for (const joint of selectedJoints()) {
          const id = CM.poseJoints[joint][side][1];

          let previous = null;

          for (const sample of recent) {
            const point = sample.points?.[id];

            if (
              previous &&
              sample.t - previous.t <= 0.8
            ) {
              line(
                previous.point,
                point,
                side === "left" ? "#50daf270" : "#e691c070"
              );
            }

            previous = CM.posePointValid(point)
              ? { point, t: sample.t }
              : null;
          }
        }
      }

      const bars = recent.filter(sample => sample.bar);

      for (let index = 1; index < bars.length; index += 1) {
        line(
          { ...bars[index - 1].bar, manual: true },
          { ...bars[index].bar, manual: true },
          "#e5c87b"
        );
      }
    }

    if (enabled("ghost")) {
      drawPose(state.reference, 0.28);
    }

    const sample = currentSample() || state.current;

    drawPose(sample);

    if (sample?.bar) {
      context.fillStyle = "#e5c87b";
      context.beginPath();

      context.arc(
        sample.bar.x * canvas.width,
        sample.bar.y * canvas.height,
        7,
        0,
        Math.PI * 2
      );

      context.fill();
    }
  }

  function drawGraph(force = false) {
    if (!state.active) return;

    if (!force && performance.now() - state.lastGraphAt < 600) {
      return;
    }

    state.lastGraphAt = performance.now();

    const samples = samplesArray();

    const series = [];

    for (const joint of selectedJoints()) {
      for (const side of selectedSides()) {
        const key = side + "_" + joint;

        series.push({
          name:
            (side === "left" ? "왼쪽 " : "오른쪽 ") +
            CM.poseJoints[joint].name,

          color: CM.colors[
            Object.keys(CM.poseJoints).indexOf(joint) %
            CM.colors.length
          ],

          dash: side === "right",

          data: samples.map(sample => ({
            x: sample.t,
            y: sample.angles?.[key] ?? null
          }))
        });
      }
    }

    $("an-chart").innerHTML = CM.lineChart(series, {
      min: 0,
      max: 180,
      unit: "°",
      currentTime: timeNow()
    });

    const current = currentSample() || state.current;

    $("an-metrics").innerHTML = series.map(item => {
      const side = item.name.startsWith("왼쪽")
        ? "left"
        : "right";

      const joint = selectedJoints().find(key => {
        return item.name.endsWith(CM.poseJoints[key].name);
      });

      const value = current?.angles?.[side + "_" + joint];

      return `
        <div>
          <small>${CM.escape(item.name)}</small>
          <div class="metric">
            ${CM.fmt(value)}<small>°</small>
          </div>
        </div>
      `;
    }).join("");

    $("an-count").textContent =
      "측정 " + samples.length + "개";
  }

  function repeatConfig() {
    return {
      key: $("an-rep-key").value,
      low: Number($("an-low").value),
      high: Number($("an-high").value)
    };
  }

  function getRepetitions() {
    if (state.manualReps.length) {
      return [...state.manualReps]
        .sort((a, b) => a.start - b.start);
    }

    if (exercise().mode !== "reps") {
      return [];
    }

    return CM.detectRepetitions(
      samplesArray(),
      repeatConfig()
    );
  }

  function drawRepetitions() {
    const reps = getRepetitions();

    $("an-repetitions").innerHTML = `
      <p>
        <strong>${reps.length}회</strong>
        ·
        ${
          state.manualReps.length
            ? "수동 지정 구간"
            : exercise().mode === "reps"
              ? "설정형 자동 인식 · 확인 필요"
              : "수동 구간 지정 또는 유지시간 분석"
        }
      </p>

      ${
        reps.length
          ? CM.barChart(
              reps.map((rep, index) => ({
                label: (index + 1) + "회",
                value: rep.end - rep.start
              })),
              "초"
            )
          : ""
      }
    `;
  }

  function refresh() {
    draw();
    drawGraph(true);
    drawRepetitions();
  }

  function guide() {
    const side = $("an-view").value === "side";

    $("an-guide").textContent = side
      ? "측면: 전신과 발이 보이도록 고정 촬영하세요. 카메라에 가까운 쪽 관절을 선택하세요."
      : "정면·후면: 어깨·골반·무릎·발이 보이도록 촬영하세요. 굽힘 각도는 측면과 직접 비교하지 마세요.";

    $("an-rep-key").value =
      "left_" + exercise().metric;
  }

  async function loadModel() {
    if (state.model) return state.model;
    if (state.modelLoading) return state.modelLoading;

    status("관절 인식 모델을 불러오는 중입니다.");

    state.modelLoading = (async function () {
      const vision = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm"
      );

      const files = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
      );

      const model = await vision.PoseLandmarker.createFromOptions(
        files,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

            delegate: "CPU"
          },

          runningMode: "IMAGE",
          numPoses: 1,
          minPoseDetectionConfidence: 0.6,
          minPosePresenceConfidence: 0.6,
          outputSegmentationMasks: false
        }
      );

      if (!state.active) {
        model.close();
        throw new Error("분석 화면이 종료되었습니다.");
      }

      state.model = model;

      status("자동 인식 준비 완료. 영상 재생 또는 전체 분석을 시작하세요.");

      return model;
    })();

    try {
      return await state.modelLoading;
    } finally {
      state.modelLoading = null;
    }
  }

  function inferCurrentFrame() {
    if (
      !state.model ||
      video.readyState < 2 ||
      !video.videoWidth
    ) {
      return;
    }

    const key = timeKey(timeNow());
    const old = state.samples.get(key);

    const result = state.model.detect(video);

    const detected = result.landmarks?.[0] || [];

    const points = Array.from({ length: 33 }, (_, index) => {
      if (old?.points?.[index]?.manual) {
        return { ...old.points[index] };
      }

      const point = detected[index];

      return point
        ? {
            x: point.x,
            y: point.y,
            visibility: point.visibility ?? 0
          }
        : null;
    });

    putSample(buildSample(timeNow(), points, old));

    return detected.length > 0;
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }

    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
  }

  function clearMeasurements() {
    state.samples.clear();
    state.current = null;
    state.reference = null;
    state.snapshots = [];
    state.manualReps = [];
    state.undo = [];
    state.redo = [];
    state.savedId = null;
    state.a = null;
    state.b = null;
    state.lastTimeKey = null;

    $("an-memo").value = "";
    $("an-range").textContent = "A — / B —";
    $("an-loop").checked = false;
    $("an-snapshots").innerHTML = "";

    state.revision = 0;
    state.savedRevision = 0;

    refresh();
  }

  function canReplaceSource() {
    if (state.scanning || state.saving) {
      CM.toast("진행 중인 작업이 끝난 뒤 변경해 주세요.");
      return false;
    }

    if (state.revision !== state.savedRevision) {
      return window.confirm(
        "저장하지 않은 분석 내용이 있습니다. 새 영상으로 바꿀까요?"
      );
    }

    return true;
  }

  async function connectCamera() {
    if (!canReplaceSource()) return;

    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error(
        "카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다."
      );
    }

    stopCamera();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: $("an-facing").value
        },

        width: { ideal: 1280 },
        height: { ideal: 720 }
      },

      audio: false
    });

    if (!state.active) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    clearMeasurements();

    if (state.fileUrl) {
      URL.revokeObjectURL(state.fileUrl);
      state.fileUrl = null;
    }

    state.file = null;
    state.stream = stream;

    video.removeAttribute("src");
    video.srcObject = stream;

    $("an-seek").disabled = true;

    await video.play();

    status("카메라 연결 완료. 자동 관절 인식을 준비해 주세요.");
  }

  function seekTo(time) {
    if (state.stream || !Number.isFinite(video.duration)) {
      return Promise.resolve();
    }

    const target = CM.clamp(
      time,
      0,
      Math.max(0, video.duration - 0.001)
    );

    if (
      Math.abs(video.currentTime - target) < 0.001 &&
      video.readyState >= 2
    ) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        clean();
        reject(new Error("영상 시점 이동 시간이 초과되었습니다."));
      }, 8000);

      function clean() {
        clearTimeout(timer);
        video.removeEventListener("seeked", onSeek);
        video.removeEventListener("error", onError);
      }

      function onSeek() {
        clean();
        resolve();
      }

      function onError() {
        clean();
        reject(new Error("영상을 읽지 못했습니다."));
      }

      video.addEventListener("seeked", onSeek, { once: true });
      video.addEventListener("error", onError, { once: true });

      video.currentTime = target;
    });
  }

  async function scanVideo() {
    if (state.scanning) return;

    if (
      state.stream ||
      !state.file ||
      !Number.isFinite(video.duration)
    ) {
      throw new Error("전체 분석은 업로드한 영상에서 사용하세요.");
    }

    if (video.duration > 600) {
      throw new Error(
        "이번 버전은 10분 이하 영상으로 분석해 주세요."
      );
    }

    await loadModel();

    state.scanning = true;
    state.cancelScan = false;

    $("an-cancel-scan").disabled = false;
    $("an-scan").disabled = true;

    video.pause();

    const oldTime = timeNow();
    const count = Math.floor(video.duration * 10);

    try {
      for (let index = 0; index <= count; index += 1) {
        if (
          state.cancelScan ||
          !state.active
        ) {
          break;
        }

        await seekTo(index / 10);

        if (!state.active || state.cancelScan) break;

        inferCurrentFrame();

        if (index % 5 === 0) {
          status(
            "전체 영상 분석 " +
            Math.round(index / Math.max(1, count) * 100) +
            "%"
          );

          draw();
          drawGraph();

          await new Promise(resolve => {
            setTimeout(resolve, 0);
          });
        }
      }

      if (state.active) {
        status(
          state.cancelScan
            ? "분석 중지. 완료된 구간은 유지됩니다."
            : "전체 분석 완료. 반복 구간과 관절점을 확인하세요."
        );
      }
    } finally {
      state.scanning = false;

      if (state.active) {
        $("an-cancel-scan").disabled = true;
        $("an-scan").disabled = false;

        await seekTo(oldTime);
        state.current = currentSample();

        refresh();
      }
    }
  }

  function loop() {
    if (!state.active) return;

    state.frameId = requestAnimationFrame(loop);

    if (!video.videoWidth) return;

    const key = timeKey(timeNow());

    $("an-time").textContent =
      CM.fmt(timeNow()) + "s";

    if (!state.stream) {
      $("an-seek").value = String(timeNow());
    }

    if (
      !state.scanning &&
      $("an-loop").checked &&
      !state.stream &&
      state.a !== null &&
      state.b !== null &&
      state.b > state.a &&
      timeNow() >= state.b
    ) {
      video.currentTime = state.a;
      return;
    }

    if (state.scanning || key === state.lastTimeKey) {
      return;
    }

    state.lastTimeKey = key;

    if (
      state.model &&
      !video.paused &&
      !state.samples.has(key)
    ) {
      try {
        inferCurrentFrame();
      } catch (error) {
        video.pause();
        status("자동 인식 오류: " + error.message);
      }
    }

    state.current = currentSample();

    draw();
    drawGraph();
  }

  /* -------------------------------------------------------
     수동 편집과 되돌리기
     ------------------------------------------------------- */

  function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function saveHistory(key, before, after) {
    state.undo.push({
      key,
      before: clone(before),
      after: clone(after)
    });

    if (state.undo.length > 40) {
      state.undo.shift();
    }

    state.redo = [];
  }

  function applyPointer(event) {
    const rect = canvas.getBoundingClientRect();

    const position = {
      x: CM.clamp(
        (event.clientX - rect.left) / rect.width,
        0,
        1
      ),

      y: CM.clamp(
        (event.clientY - rect.top) / rect.height,
        0,
        1
      )
    };

    const time = state.dragTime;
    const key = timeKey(time);

    const old = state.samples.get(key);

    const points = old?.points
      ? clone(old.points)
      : Array(33).fill(null);

    let sample;

    if ($("an-tool").value === "bar") {
      sample = buildSample(time, points, old);
      sample.bar = position;
      sample.manual = true;
    } else {
      const id = Number($("an-edit-point").value);

      points[id] = {
        ...position,
        visibility: 1,
        manual: true
      };

      sample = buildSample(time, points, old);
    }

    putSample(sample);
    draw();
  }

  canvas.onpointerdown = function (event) {
    if (
      $("an-tool").value === "view" ||
      state.scanning ||
      !video.videoWidth
    ) {
      return;
    }

    if (state.stream) {
      CM.toast("수동 보정은 업로드 영상에서 사용하세요.");
      return;
    }

    video.pause();

    state.dragTime = timeNow();
    state.dragBefore = clone(currentSample());

    canvas.setPointerCapture(event.pointerId);

    applyPointer(event);
  };

  canvas.onpointermove = function (event) {
    if (state.dragTime === null) return;
    applyPointer(event);
  };

  function finishDrag(event) {
    if (state.dragTime === null) return;

    const key = timeKey(state.dragTime);

    saveHistory(
      key,
      state.dragBefore,
      state.samples.get(key)
    );

    state.dragTime = null;
    state.dragBefore = null;

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    refresh();
  }

  canvas.onpointerup = finishDrag;
  canvas.onpointercancel = finishDrag;

  function restoreHistory(direction) {
    const source = direction === "undo"
      ? state.undo
      : state.redo;

    const target = direction === "undo"
      ? state.redo
      : state.undo;

    const item = source.pop();

    if (!item) {
      CM.toast("변경할 편집 기록이 없습니다.");
      return;
    }

    const sample = direction === "undo"
      ? item.before
      : item.after;

    if (sample) {
      state.samples.set(item.key, clone(sample));
    } else {
      state.samples.delete(item.key);
    }

    target.push(item);

    changed();

    state.current = currentSample();

    refresh();
  }

  /* -------------------------------------------------------
     장면 캡처
     ------------------------------------------------------- */

  function captureSnapshot() {
    if (!video.videoWidth || video.readyState < 2) {
      throw new Error("저장할 영상 장면이 없습니다.");
    }

    if (state.snapshots.length >= 12) {
      throw new Error("한 분석에 최대 12개 장면을 저장할 수 있습니다.");
    }

    draw();

    const output = document.createElement("canvas");
    const ratio = Math.min(1, 960 / video.videoWidth);

    output.width = Math.round(video.videoWidth * ratio);
    output.height = Math.round(video.videoHeight * ratio);

    const ctx = output.getContext("2d");

    ctx.drawImage(video, 0, 0, output.width, output.height);
    ctx.drawImage(canvas, 0, 0, output.width, output.height);

    state.snapshots.push({
      id: CM.uid(),
      t: timeNow(),
      image: output.toDataURL("image/jpeg", 0.8)
    });

    changed();

    drawSnapshots();
  }

  function drawSnapshots() {
    $("an-snapshots").innerHTML =
      state.snapshots.map(snapshot => `
        <div class="snapshot-card">
          <img
            class="snapshot"
            src="${snapshot.image}"
            alt="${CM.fmt(snapshot.t)}초 분석 장면"
          >

          <div class="row spread">
            <small>${CM.fmt(snapshot.t)}초</small>

            <button
              class="small"
              data-remove-snapshot="${snapshot.id}"
            >
              삭제
            </button>
          </div>
        </div>
      `).join("");
  }

  /* -------------------------------------------------------
     분석 저장
     ------------------------------------------------------- */

  async function saveAnalysis(openReport = false) {
    if (state.saving || state.scanning) {
      throw new Error("진행 중인 작업을 먼저 마쳐 주세요.");
    }

    const samples = samplesArray();

    if (!samples.length) {
      throw new Error(
        "자동 분석 또는 수동 기준점 지정 후 저장해 주세요."
      );
    }

    const low = Number($("an-low").value);
    const high = Number($("an-high").value);

    if (exercise().mode === "reps" && low >= high) {
      throw new Error("낮은 각도는 높은 각도보다 작아야 합니다.");
    }

    video.pause();

    state.saving = true;

    $("an-save").disabled = true;
    $("an-report").disabled = true;

    const revision = state.revision;
    const id = state.savedId || CM.uid();

    try {
      const athleteId = $("an-athlete").value;

      const athlete = athleteId
        ? await CM.db.get("athletes", athleteId)
        : null;

      const existing = await CM.db.get("records", id);

      let mediaId = existing?.mediaId || null;

      if (state.file && $("an-keep-media").checked) {
        mediaId = id;

        await CM.db.put("media", {
          id: mediaId,
          name: state.file.name,
          type: state.file.type,
          blob: state.file
        });
      }

      const record = {
        ...existing,

        id,

        athleteId,
        athleteName: athlete?.name || "임시 분석",

        exercise: { ...exercise() },
        exerciseId: exercise().id,

        view: $("an-view").value,

        weight: $("an-load").value === ""
          ? null
          : Number($("an-load").value),

        targetReps: Number($("an-target").value) || null,

        createdAt:
          existing?.createdAt || new Date().toISOString(),

        updatedAt: new Date().toISOString(),

        width: state.width,
        height: state.height,

        source: state.file ? "upload" : "camera",

        sourceName: state.file?.name || "실시간 카메라",

        duration: state.file
          ? video.duration
          : samples[samples.length - 1].t - samples[0].t,

        samples,

        repetitions: getRepetitions(),

        repetitionConfig: repeatConfig(),

        repetitionSource: state.manualReps.length
          ? "manual"
          : exercise().mode === "reps"
            ? "experimental-auto"
            : "none",

        range:
          state.a !== null &&
          state.b !== null &&
          state.b > state.a
            ? { start: state.a, end: state.b }
            : null,

        snapshots: clone(state.snapshots),

        memo: $("an-memo").value.trim(),

        coachFeedback: existing?.coachFeedback || "",

        mediaId,

        measurementVersion: "2d-v1",

        angleDefinition: "three-point-internal-angle",

        barTracking: "manual",

        clinicalValidation: false
      };

      await CM.db.put("records", record);

      state.savedId = id;
      state.savedRevision = revision;

      CM.selectedAthlete = athleteId;
      CM.selectedRecord = id;

      CM.toast("분석 기록을 저장했습니다.");

      if (openReport) {
        location.hash = "reports";
      }
    } finally {
      state.saving = false;

      if (state.active) {
        $("an-save").disabled = false;
        $("an-report").disabled = false;
      }
    }
  }

  /* -------------------------------------------------------
     이벤트
     ------------------------------------------------------- */

  function safe(handler) {
    return async function (event) {
      try {
        await handler(event);
      } catch (error) {
        status(error.message);
        CM.toast(error.message || "작업을 완료하지 못했습니다.");
      }
    };
  }

  $("an-camera").onclick = safe(connectCamera);

  $("an-camera-stop").onclick = function () {
    stopCamera();
    status("카메라를 종료했습니다. 측정 기록은 유지됩니다.");
  };

  $("an-model").onclick = safe(async function () {
    await loadModel();

    if (video.readyState >= 2) {
      inferCurrentFrame();
      refresh();
    }
  });

  $("an-file").onchange = safe(async function () {
    const file = $("an-file").files?.[0];

    if (!file) return;

    if (!canReplaceSource()) {
      $("an-file").value = "";
      return;
    }

    stopCamera();
    video.pause();

    clearMeasurements();

    if (state.fileUrl) {
      URL.revokeObjectURL(state.fileUrl);
    }

    state.file = file;
    state.fileUrl = URL.createObjectURL(file);

    video.srcObject = null;
    video.src = state.fileUrl;
    video.load();

    status(
      "영상 준비 중. 지원되지 않는 형식이면 MP4(H.264)로 변환해 주세요."
    );
  });

  video.onloadedmetadata = function () {
    resizeStage();
    status("영상 준비 완료.");
  };

  video.onloadeddata = function () {
    resizeStage();
    draw();
  };

  video.onerror = function () {
    status(
      "영상 재생에 실패했습니다. 파일 형식과 손상 여부를 확인하세요."
    );
  };

  video.onseeked = function () {
    state.current = currentSample();
    state.lastTimeKey = null;

    if (!state.scanning) {
      draw();
      drawGraph(true);
    }
  };

  $("an-play").onclick = safe(async function () {
    if (state.scanning) return;

    if (video.readyState < 2) {
      throw new Error("영상을 먼저 연결해 주세요.");
    }

    if (video.paused) {
      await video.play();
    } else {
      video.pause();
      refresh();
    }
  });

  $("an-speed").onchange = function () {
    video.playbackRate = Number($("an-speed").value);
  };

  $("an-back").onclick = safe(async function () {
    if (state.scanning) return;
    video.pause();
    await seekTo(timeNow() - 0.1);
  });

  $("an-forward").onclick = safe(async function () {
    if (state.scanning) return;
    video.pause();
    await seekTo(timeNow() + 0.1);
  });

  $("an-seek").oninput = safe(async function () {
    if (state.scanning) return;
    video.pause();
    await seekTo(Number($("an-seek").value));
  });

  $("an-scan").onclick = safe(scanVideo);

  $("an-cancel-scan").onclick = function () {
    state.cancelScan = true;
  };

  main.querySelectorAll(
    "[data-overlay], [data-joint]"
  ).forEach(input => {
    input.onchange = refresh;
  });

  $("an-side").onchange = refresh;

  $("an-all-joints").onclick = function () {
    main.querySelectorAll("[data-joint]").forEach(input => {
      input.checked = true;
    });

    refresh();
  };

  $("an-no-joints").onclick = function () {
    main.querySelectorAll("[data-joint]").forEach(input => {
      input.checked = false;
    });

    refresh();
  };

  $("an-reference").onclick = function () {
    const sample = currentSample() || state.current;

    if (!sample) {
      CM.toast("먼저 관절점을 인식하거나 수동 지정하세요.");
      return;
    }

    state.reference = clone(sample);

    main.querySelector(
      '[data-overlay="ghost"]'
    ).checked = true;

    draw();

    CM.toast("현재 관절 위치를 기준 자세로 설정했습니다.");
  };

  $("an-snapshot").onclick = safe(captureSnapshot);

  $("an-snapshots").onclick = function (event) {
    const button = event.target.closest(
      "[data-remove-snapshot]"
    );

    if (!button) return;

    state.snapshots = state.snapshots.filter(snapshot => {
      return snapshot.id !== button.dataset.removeSnapshot;
    });

    changed();
    drawSnapshots();
  };

  $("an-undo").onclick = function () {
    restoreHistory("undo");
  };

  $("an-redo").onclick = function () {
    restoreHistory("redo");
  };

  $("an-floor").oninput = draw;
  $("an-floor-angle").oninput = draw;

  function updateRange() {
    $("an-range").textContent =
      "A " + CM.fmt(state.a) + "초 / " +
      "B " + CM.fmt(state.b) + "초";

    changed();
  }

  $("an-mark-a").onclick = function () {
    state.a = timeNow();
    updateRange();
  };

  $("an-mark-b").onclick = function () {
    state.b = timeNow();
    updateRange();
  };

  $("an-add-rep").onclick = function () {
    if (
      state.a === null ||
      state.b === null ||
      state.b <= state.a
    ) {
      CM.toast("시작 A보다 뒤에 종료 B를 지정하세요.");
      return;
    }

    const overlap = state.manualReps.some(rep => {
      return state.a < rep.end && state.b > rep.start;
    });

    if (overlap) {
      CM.toast("기존 수동 반복과 구간이 겹칩니다.");
      return;
    }

    state.manualReps.push({
      id: CM.uid(),
      start: state.a,
      end: state.b,
      duration: state.b - state.a,
      source: "manual"
    });

    changed();
    drawRepetitions();
  };

  $("an-clear-reps").onclick = function () {
    if (!state.manualReps.length) return;

    if (!window.confirm("수동 반복 구간을 초기화할까요?")) {
      return;
    }

    state.manualReps = [];

    changed();
    drawRepetitions();
  };

  $("an-recount").onclick = function () {
    const config = repeatConfig();

    if (config.low >= config.high) {
      CM.toast("낮은 각도는 높은 각도보다 작아야 합니다.");
      return;
    }

    changed();
    drawRepetitions();
  };

  $("an-exercise").onchange = function () {
    CM.selectedExercise = $("an-exercise").value;

    guide();
    changed();
    drawRepetitions();
  };

  $("an-view").onchange = function () {
    guide();
    changed();
  };

  for (const id of [
    "an-athlete",
    "an-load",
    "an-target",
    "an-memo",
    "an-low",
    "an-high",
    "an-rep-key",
    "an-keep-media"
  ]) {
    $(id).addEventListener("change", changed);
  }

  $("an-save").onclick = safe(function () {
    return saveAnalysis(false);
  });

  $("an-report").onclick = safe(function () {
    return saveAnalysis(true);
  });

  $("an-new").onclick = function () {
    if (!canReplaceSource()) return;

    clearMeasurements();

    if (!state.stream && video.readyState >= 2) {
      video.pause();
      video.currentTime = 0;
    }

    status("새 분석을 시작합니다.");
  };

  const unbindChart = CM.bindChartSeek(
    $("an-chart"),
    function (time) {
      if (state.scanning || state.stream) return;

      video.pause();

      seekTo(time).catch(error => {
        CM.toast(error.message);
      });
    }
  );

  function beforeUnload(event) {
    if (state.revision !== state.savedRevision) {
      event.preventDefault();
      event.returnValue = "";
    }
  }

  window.addEventListener("beforeunload", beforeUnload);

  /* app.js가 화면 전환 전에 호출합니다. */
  CM.analysisCanLeave = function () {
    if (state.saving) {
      CM.toast("저장이 끝날 때까지 기다려 주세요.");
      return false;
    }

    if (state.revision !== state.savedRevision) {
      return window.confirm(
        "저장하지 않은 분석 내용이 있습니다. 화면을 이동할까요?"
      );
    }

    return true;
  };

  /* app.js가 화면 전환 시 호출합니다. */
  CM.analysisCleanup = function () {
    state.active = false;
    state.cancelScan = true;

    cancelAnimationFrame(state.frameId);

    stopCamera();
    video.pause();

    if (state.fileUrl) {
      URL.revokeObjectURL(state.fileUrl);
    }

    if (state.model) {
      state.model.close();
      state.model = null;
    }

    window.removeEventListener(
      "beforeunload",
      beforeUnload
    );

    unbindChart();

    CM.analysisCanLeave = null;
    CM.analysisCleanup = null;
  };

  guide();
  refresh();

  state.frameId = requestAnimationFrame(loop);
};