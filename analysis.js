/* 실버스타 스포츠 과학원 · CODEON MOTION
   analysis.js

   - 카메라 연결 / 전면·후면 전환
   - 영상 업로드 / 구간 분석
   - 2D 스켈레톤 / 각도 / 기준선 / 궤적
   - 좌우·관절 선택 / 그래프
   - 수동 기준점 수정 / 실행 취소·다시 실행
   - 수동 바벨 기준점
   - 실험적 반복 감지 / 수동 반복 구간
   - 동작 사진 / 원본 영상 선택 저장

   카메라 영상 자체는 녹화하지 않습니다.
   카메라는 분석값과 캡처 사진을 저장합니다.
*/

(() => {
  "use strict";

  window.CM = window.CM || {};
  const CM = window.CM;

  const esc = value => CM.escape(String(value ?? ""));
  const finite = Number.isFinite;
  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

  const jointNames = {
    knee: "무릎",
    hip: "고관절",
    ankle: "발목",
    elbow: "팔꿈치",
    shoulder: "어깨"
  };

  CM.poseJoints = {
    shoulder: {
      left: [23, 11, 13],
      right: [24, 12, 14]
    },
    elbow: {
      left: [11, 13, 15],
      right: [12, 14, 16]
    },
    hip: {
      left: [11, 23, 25],
      right: [12, 24, 26]
    },
    knee: {
      left: [23, 25, 27],
      right: [24, 26, 28]
    },
    ankle: {
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

  const connections = [
    [11, 12],
    [11, 13], [13, 15],
    [12, 14], [14, 16],
    [11, 23], [12, 24],
    [23, 24],
    [23, 25], [25, 27],
    [24, 26], [26, 28],
    [27, 29], [29, 31], [27, 31],
    [28, 30], [30, 32], [28, 32]
  ];

  const leftPoints = new Set([
    11, 13, 15, 23, 25, 27, 29, 31
  ]);

  const rightPoints = new Set([
    12, 14, 16, 24, 26, 28, 30, 32
  ]);

  CM.posePointValid = point =>
    Boolean(
      point &&
      finite(point.x) &&
      finite(point.y) &&
      (
        point.manual ||
        (finite(point.visibility) && point.visibility >= 0.55)
      )
    );

  CM.angle2D = (a, b, c, width = 1, height = 1) => {
    if (
      !CM.posePointValid(a) ||
      !CM.posePointValid(b) ||
      !CM.posePointValid(c)
    ) {
      return null;
    }

    const ux = (a.x - b.x) * width;
    const uy = (a.y - b.y) * height;
    const vx = (c.x - b.x) * width;
    const vy = (c.y - b.y) * height;

    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (length < 1e-8) return null;

    return Math.acos(
      clamp((ux * vx + uy * vy) / length, -1, 1)
    ) * 180 / Math.PI;
  };

  CM.measurePose = (points, width, height) => {
    const angles = {};
    const metrics = {};

    for (const [joint, sides] of Object.entries(CM.poseJoints)) {
      for (const [side, ids] of Object.entries(sides)) {
        angles[`${side}_${joint}`] = CM.angle2D(
          points[ids[0]],
          points[ids[1]],
          points[ids[2]],
          width,
          height
        );
      }
    }

    for (const side of ["left", "right"]) {
      const shoulder = points[side === "left" ? 11 : 12];
      const hip = points[side === "left" ? 23 : 24];

      metrics[`${side}_trunk`] =
        CM.posePointValid(shoulder) && CM.posePointValid(hip)
          ? Math.atan2(
              Math.abs((shoulder.x - hip.x) * width),
              (hip.y - shoulder.y) * height
            ) * 180 / Math.PI
          : null;

      const knee = points[side === "left" ? 25 : 26];
      const toe = points[side === "left" ? 31 : 32];

      metrics[`${side}_kneeToe`] =
        CM.posePointValid(knee) && CM.posePointValid(toe)
          ? (knee.x - toe.x) * width
          : null;
    }

    function tilt(a, b) {
      if (!CM.posePointValid(a) || !CM.posePointValid(b)) {
        return null;
      }

      let value = Math.atan2(
        (b.y - a.y) * height,
        (b.x - a.x) * width
      ) * 180 / Math.PI;

      if (value > 90) value -= 180;
      if (value < -90) value += 180;

      return value;
    }

    metrics.shoulderTilt = tilt(points[11], points[12]);
    metrics.hipTilt = tilt(points[23], points[24]);

    if (
      CM.posePointValid(points[23]) &&
      CM.posePointValid(points[24])
    ) {
      metrics.pelvisX = (points[23].x + points[24].x) * 50;
      metrics.pelvisY = (points[23].y + points[24].y) * 50;
    } else {
      metrics.pelvisX = null;
      metrics.pelvisY = null;
    }

    return { angles, metrics };
  };

  CM.detectRepetitions = (
    samples,
    {
      key = "left_knee",
      low = 100,
      high = 155,
      minDuration = 0.5,
      maxGap = 0.8
    } = {}
  ) => {
    if (!finite(low) || !finite(high) || low >= high) return [];

    const sorted = samples
      .filter(sample => finite(sample.t))
      .slice()
      .sort((a, b) => a.t - b.t);

    const repetitions = [];

    let ready = false;
    let moving = false;
    let start = 0;
    let bottom = 0;
    let minimum = Infinity;
    let lastTime = null;

    for (const sample of sorted) {
      const value = sample.angles?.[key];

      if (
        !finite(value) ||
        (lastTime !== null && sample.t - lastTime > maxGap)
      ) {
        ready = false;
        moving = false;
        minimum = Infinity;
      }

      lastTime = sample.t;
      if (!finite(value)) continue;

      if (!ready && value >= high) {
        ready = true;
        start = sample.t;
        continue;
      }

      if (!ready) continue;

      if (!moving) {
        if (value >= high) start = sample.t;

        if (value <= low) {
          moving = true;
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
        const duration = sample.t - start;

        if (duration >= minDuration) {
          repetitions.push({
            start,
            bottom,
            end: sample.t,
            duration,
            downTime: bottom - start,
            upTime: sample.t - bottom,
            minAngle: minimum,
            source: "experimental-auto",
            key
          });
        }

        moving = false;
        start = sample.t;
        minimum = Infinity;
      }
    }

    return repetitions;
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  CM.renderAnalysis = async () => {
    if (typeof CM.analysisCleanup === "function") {
      CM.analysisCleanup();
    }

    await CM.loadExercises();

    const athletes = await CM.db.all("athletes");
    const main = document.querySelector("#main");

    const selectedExercise =
      CM.exercises.find(item => item.id === CM.selectedExercise) ||
      CM.exercises[0];

    if (!selectedExercise) {
      main.innerHTML = CM.empty("등록된 운동이 없습니다.");
      return;
    }

    main.innerHTML = `
      ${CM.heading(
        "자세 분석",
        "SILVERSTAR · MOTION ANALYSIS",
        `
          <button id="an-save" class="primary">분석 저장</button>
          <button id="an-report">저장 후 리포트</button>
        `
      )}

      <div class="analysis-layout">
        <aside class="panel">
          <h2>분석 설정</h2>

          <label>
            선수
            <select id="an-athlete">
              <option value="">게스트</option>
              ${athletes.map(athlete => `
                <option value="${esc(athlete.id)}"
                  ${athlete.id === CM.selectedAthlete ? "selected" : ""}>
                  ${esc(athlete.name)}
                </option>
              `).join("")}
            </select>
          </label>

          <label style="display:block;margin-top:12px">
            운동
            <select id="an-exercise">
              ${CM.exercises.map(exercise => `
                <option value="${esc(exercise.id)}"
                  ${exercise.id === selectedExercise.id ? "selected" : ""}>
                  ${esc(exercise.category)} · ${esc(exercise.name)}
                </option>
              `).join("")}
            </select>
          </label>

          <label style="display:block;margin-top:12px">
            촬영 방향
            <select id="an-view">
              <option value="side">측면</option>
              <option value="front">정면</option>
              <option value="back">후면</option>
            </select>
          </label>

          <div class="grid g2" style="margin-top:12px">
            <label>
              중량 kg
              <input id="an-weight" type="number"
                min="0" max="1000" step="0.5" placeholder="선택">
            </label>
            <label>
              목표 반복
              <input id="an-target" type="number"
                min="1" max="9999" step="1" placeholder="선택">
            </label>
          </div>

          <hr>

          <button id="an-camera" class="primary"
            style="width:100%">
            카메라 연결
          </button>

          <button id="an-switch"
            style="width:100%;margin-top:8px">
            전면 / 후면 전환
          </button>

          <p id="an-camera-label" class="muted">
            선택 카메라: 후면
          </p>

          <label>
            영상 업로드
            <input id="an-file" type="file" accept="video/*">
          </label>

          <label style="display:flex;gap:8px;margin-top:12px">
            <input id="an-keep-media" type="checkbox">
            업로드 원본도 브라우저에 저장
          </label>

          <p class="muted" style="font-size:12px">
            카메라 영상은 녹화하지 않습니다.
            분석값과 캡처 사진을 저장합니다.
          </p>

          <hr>

          <h3>분석 구간</h3>

          <div class="grid g2">
            <label>
              시작 초
              <input id="an-range-start" type="number"
                value="0" min="0" step="0.1">
            </label>
            <label>
              종료 초
              <input id="an-range-end" type="number"
                min="0" step="0.1" placeholder="영상 끝">
            </label>
          </div>

          <button id="an-scan"
            style="width:100%;margin-top:10px">
            업로드 영상 구간 분석
          </button>

          <button id="an-cancel"
            style="width:100%;margin-top:8px" hidden>
            구간 분석 중단
          </button>

          <label style="display:flex;gap:8px;margin-top:10px">
            <input id="an-loop" type="checkbox">
            지정 구간 반복 재생
          </label>

          <hr>

          <h3>자동 반복 감지 · 실험</h3>

          <label>
            기준 관절
            <select id="an-rep-key">
              ${Object.entries(jointNames).map(([key, name]) => `
                <option value="left_${key}">왼쪽 ${name}</option>
                <option value="right_${key}">오른쪽 ${name}</option>
              `).join("")}
            </select>
          </label>

          <div class="grid g2" style="margin-top:10px">
            <label>
              굽힌 각도 이하
              <input id="an-low" type="number"
                min="0" max="180" value="100">
            </label>
            <label>
              편 각도 이상
              <input id="an-high" type="number"
                min="0" max="180" value="155">
            </label>
          </div>

          <p class="muted" style="font-size:12px">
            큰 각도 → 작은 각도 → 큰 각도 순서를 감지합니다.
            모든 운동에 맞는 기준은 아닙니다.
            운동에 맞게 조정하거나 수동 구간을 사용하세요.
          </p>

          <label>
            메모
            <textarea id="an-memo" rows="4"></textarea>
          </label>
        </aside>

        <div>
          <section class="panel" style="margin-bottom:18px">
            <div id="an-stage" class="stage"
              style="aspect-ratio:16/9;position:relative;
                     overflow:hidden;background:#030b11">
              <video id="an-video" muted playsinline
                style="width:100%;height:100%;display:block;
                       object-fit:fill"></video>
              <canvas id="an-canvas"
                style="position:absolute;inset:0;width:100%;height:100%;
                       touch-action:none"></canvas>
              <div id="an-placeholder"
                style="position:absolute;inset:0;display:grid;
                       place-items:center;pointer-events:none">
                <p class="muted">카메라를 연결하거나 영상을 선택하세요.</p>
              </div>
            </div>

            <p id="an-status" role="status" class="muted">
              분석 준비
            </p>

            <div class="row no-print"
              style="gap:8px;flex-wrap:wrap">
              <button id="an-back">−0.1초</button>
              <button id="an-play">재생 / 일시정지</button>
              <button id="an-next">+0.1초</button>

              <select id="an-speed" aria-label="재생 속도"
                style="width:auto">
                <option value="0.25">0.25배</option>
                <option value="0.5">0.5배</option>
                <option value="1" selected>1배</option>
                <option value="1.5">1.5배</option>
                <option value="2">2배</option>
              </select>

              <button id="an-snapshot">동작 사진 저장</button>
            </div>

            <input id="an-seek" type="range"
              min="0" max="1" step="0.01" value="0"
              aria-label="영상 탐색" style="width:100%;margin-top:12px">

            <div class="toggles row"
              style="gap:12px;flex-wrap:wrap;margin-top:14px">
              <label><input id="an-skeleton" type="checkbox" checked>
                스켈레톤
              </label>
              <label><input id="an-angles" type="checkbox" checked>
                각도
              </label>
              <label><input id="an-guides" type="checkbox" checked>
                기준선
              </label>
              <label><input id="an-trails" type="checkbox">
                궤적
              </label>
              <label><input id="an-ghost" type="checkbox">
                기준 자세
              </label>
            </div>

            <div class="grid g3" style="margin-top:14px">
              <label>
                표시 방향
                <select id="an-side">
                  <option value="both">좌우 모두</option>
                  <option value="left">왼쪽만</option>
                  <option value="right">오른쪽만</option>
                </select>
              </label>
              <label>
                기준선 높이 %
                <input id="an-floor" type="number"
                  min="0" max="100" value="85">
              </label>
              <div>
                <button id="an-set-ghost" style="margin-top:20px">
                  현재 자세를 기준으로
                </button>
              </div>
            </div>

            <div class="toggles row"
              style="margin-top:14px;gap:12px;flex-wrap:wrap">
              ${Object.entries(jointNames).map(([key, name]) => `
                <label>
                  <input type="checkbox" data-joint="${key}" checked>
                  ${name}
                </label>
              `).join("")}
            </div>
          </section>

          <section class="panel" style="margin-bottom:18px">
            <h2>관절 각도 변화</h2>
            <div id="an-values" class="grid g3"></div>
            <div id="an-chart" class="chart"
              style="margin-top:16px"></div>
            <p class="muted">
              그래프는 선택한 관절과 방향만 표시합니다.
              업로드 영상에서는 그래프를 눌러 해당 시점으로 이동할 수 있습니다.
            </p>
          </section>

          <section class="panel" style="margin-bottom:18px">
            <h2>수동 기준점 수정</h2>
            <p class="muted">
              일시정지 후 수정할 기준점을 선택하고
              영상의 위치를 클릭하거나 드래그하세요.
              손목은 팔꿈치 각도 계산 등에 사용하는 위치 기준점입니다.
            </p>

            <div class="grid g2">
              <label>
                편집 모드
                <select id="an-edit">
                  <option value="none">편집 안 함</option>
                  <option value="joint">관절 기준점</option>
                  <option value="bar">바벨 기준점</option>
                </select>
              </label>
              <label>
                수정할 관절
                <select id="an-point">
                  ${Object.entries(CM.posePointNames).map(([id, name]) => `
                    <option value="${id}">${name}</option>
                  `).join("")}
                </select>
              </label>
            </div>

            <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">
              <button id="an-undo">실행 취소</button>
              <button id="an-redo">다시 실행</button>
              <button id="an-clear-bar">현재 바벨 점 삭제</button>
            </div>

            <p class="muted">
              바벨 점은 직접 지정합니다.
              자동 바벨 추적이나 실제 이동 거리 측정은 아닙니다.
            </p>
          </section>

          <section class="panel" style="margin-bottom:18px">
            <div class="row spread" style="gap:10px;flex-wrap:wrap">
              <h2>반복 구간</h2>
              <strong id="an-rep-count">0회</strong>
            </div>

            <div class="row" style="gap:8px;flex-wrap:wrap">
              <button id="an-mark-start">현재 시점을 시작으로</button>
              <button id="an-mark-end">현재 시점을 종료로</button>
              <button id="an-remove-rep">마지막 수동 구간 취소</button>
              <button id="an-clear-reps">수동 구간 전체 지우기</button>
            </div>

            <p id="an-mark-label" class="muted">수동 구간 시작점 없음</p>
            <div id="an-rep-list"></div>
          </section>

          <section class="panel">
            <h2>저장할 동작 사진</h2>
            <p class="muted">최대 12장. 선택한 표시 상태로 저장합니다.</p>
            <div id="an-snapshots" class="grid g3"></div>
          </section>
        </div>
      </div>
    `;

    const $ = selector => main.querySelector(selector);
    const video = $("#an-video");
    const canvas = $("#an-canvas");
    const context = canvas.getContext("2d");
    const stage = $("#an-stage");

    const controller = new AbortController();
    const signal = controller.signal;

    let active = true;
    let stream = null;
    let objectURL = null;
    let model = null;
    let modelPromise = null;

    let source = null;
    let sourceFile = null;
    let sourceName = "";
    let facing = "environment";

    let cameraStartedAt = 0;
    let cameraElapsed = 0;
    let cameraRunning = false;

    let width = 1280;
    let height = 720;

    let sourceBusy = false;
    let saving = false;
    let scanning = false;
    let cancelScan = false;
    let dirty = false;

    let savedId = null;
    let mediaId = null;
    let createdAt = null;

    let raf = 0;
    let lastDetectAt = 0;
    let lastGraphAt = 0;
    let lastDetectionKey = null;
    let inferenceFailed = false;

    let ghost = null;
    let markStart = null;

    let drag = null;
    const history = [];
    const future = [];
    const samples = new Map();
    const snapshots = [];
    const manualRepetitions = [];

    function on(selector, type, handler) {
      const node = $(selector);

      node.addEventListener(type, event => {
        try {
          Promise.resolve(handler(event)).catch(showError);
        } catch (error) {
          showError(error);
        }
      }, { signal });
    }

    function showError(error) {
      console.error(error);
      if (!active) return;

      const names = {
        NotAllowedError:
          "카메라 권한이 허용되지 않았습니다. 사파리의 사이트 카메라 설정을 확인해 주세요.",
        NotFoundError:
          "사용 가능한 카메라를 찾지 못했습니다.",
        NotReadableError:
          "카메라를 열지 못했습니다. 다른 앱의 카메라 사용을 종료하고 다시 시도해 주세요.",
        OverconstrainedError:
          "요청한 카메라 설정을 사용할 수 없습니다."
      };

      const text =
        names[error?.name] ||
        error?.message ||
        "작업 중 오류가 발생했습니다.";

      $("#an-status").textContent = text;
      CM.toast(text, 6000);
    }

    function status(text) {
      if (active) $("#an-status").textContent = text;
    }

    function exercise() {
      return CM.exercises.find(
        item => item.id === $("#an-exercise").value
      ) || selectedExercise;
    }

    function sortedSamples() {
      return [...samples.values()].sort((a, b) => a.t - b.t);
    }

    function keyOf(time) {
      return Math.round(time * 10);
    }

    function currentTime() {
      if (source === "upload") return video.currentTime || 0;

      if (source === "camera") {
        return cameraElapsed + (
          cameraRunning
            ? (performance.now() - cameraStartedAt) / 1000
            : 0
        );
      }

      return 0;
    }

    function nearestSample(time, tolerance = 0.2) {
      const key = keyOf(time);
      let best = null;
      let distance = Infinity;

      for (let offset = -2; offset <= 2; offset++) {
        const sample = samples.get(key + offset);
        if (!sample) continue;

        const delta = Math.abs(sample.t - time);

        if (delta < distance && delta <= tolerance) {
          best = sample;
          distance = delta;
        }
      }

      return best;
    }

    function stopCameraClock() {
      if (!cameraRunning) return;
      cameraElapsed = currentTime();
      cameraRunning = false;
    }

    function startCameraClock() {
      if (cameraRunning) return;
      cameraStartedAt = performance.now();
      cameraRunning = true;
    }

    function pausePlayback() {
      if (source === "camera") stopCameraClock();
      video.pause();
    }

    function syncButtons() {
      if (!active) return;

      const busy = sourceBusy || saving || scanning;
      const metadataLocked = busy || samples.size > 0;

      for (const id of [
        "#an-camera", "#an-switch", "#an-file",
        "#an-save", "#an-report"
      ]) {
        $(id).disabled = busy;
      }

      for (const id of [
        "#an-athlete", "#an-exercise", "#an-view",
        "#an-weight", "#an-target"
      ]) {
        $(id).disabled = metadataLocked;
      }

      for (const id of [
        "#an-back", "#an-next", "#an-seek", "#an-speed"
      ]) {
        $(id).disabled = busy || source !== "upload";
      }

      $("#an-play").disabled = busy || !source;
      $("#an-scan").disabled = busy || source !== "upload";
      $("#an-cancel").hidden = !scanning;
      $("#an-edit").disabled = busy;
      $("#an-snapshot").disabled = busy || !source;
      $("#an-keep-media").disabled = busy || source !== "upload";

      for (const id of [
        "#an-range-start", "#an-range-end",
        "#an-rep-key", "#an-low", "#an-high",
        "#an-memo"
      ]) {
        $(id).disabled = busy;
      }

      $("#an-undo").disabled = busy || !history.length;
      $("#an-redo").disabled = busy || !future.length;
    }

    async function getModel() {
      if (model) return model;
      if (modelPromise) return modelPromise;

      status("자세 인식 모델을 불러오는 중입니다…");

      modelPromise = (async () => {
        const vision = await import(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm"
        );

        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
        );

        const created = await vision.PoseLandmarker.createFromOptions(
          fileset,
          {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/" +
                "pose_landmarker/pose_landmarker_lite/float16/1/" +
                "pose_landmarker_lite.task",
              delegate: "CPU"
            },
            runningMode: "IMAGE",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
            outputSegmentationMasks: false
          }
        );

        if (!active) {
          created.close();
          throw new Error("분석 화면이 닫혔습니다.");
        }

        model = created;
        return created;
      })();

      try {
        return await modelPromise;
      } finally {
        modelPromise = null;
      }
    }

    function waitForVideo() {
      return new Promise((resolve, reject) => {
        if (video.readyState >= 2 && video.videoWidth > 0) {
          resolve();
          return;
        }

        const timer = setTimeout(() => {
          finish(new Error("영상 준비 시간이 초과되었습니다."));
        }, 15000);

        function finish(error) {
          clearTimeout(timer);
          video.removeEventListener("loadeddata", ready);
          video.removeEventListener("error", failed);
          signal.removeEventListener("abort", aborted);

          if (error) reject(error);
          else resolve();
        }

        function ready() {
          if (video.videoWidth > 0) finish();
        }

        function failed() {
          finish(new Error(
            "이 영상을 재생할 수 없습니다. 다른 형식의 영상을 사용해 주세요."
          ));
        }

        function aborted() {
          finish(new Error("분석 화면이 닫혔습니다."));
        }

        video.addEventListener("loadeddata", ready);
        video.addEventListener("error", failed);
        signal.addEventListener("abort", aborted, { once: true });
      });
    }

    function resize() {
      width = video.videoWidth || width;
      height = video.videoHeight || height;

      canvas.width = width;
      canvas.height = height;
      stage.style.aspectRatio = `${width} / ${height}`;
    }

    function releaseSource() {
      pausePlayback();

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }

      video.srcObject = null;
      video.removeAttribute("src");
      video.load();

      if (objectURL) {
        URL.revokeObjectURL(objectURL);
        objectURL = null;
      }
    }

    function clearMeasurement() {
      samples.clear();
      snapshots.length = 0;
      manualRepetitions.length = 0;
      history.length = 0;
      future.length = 0;

      savedId = null;
      mediaId = null;
      createdAt = null;
      ghost = null;
      markStart = null;
      drag = null;

      cameraElapsed = 0;
      cameraRunning = false;
      lastDetectionKey = null;
      inferenceFailed = false;
      dirty = false;

      $("#an-edit").value = "none";
      $("#an-ghost").checked = false;
      $("#an-range-start").value = "0";
      $("#an-range-end").value = "";
      $("#an-mark-label").textContent = "수동 구간 시작점 없음";

      renderSnapshots();
      updateGraph(true);
    }

    function confirmSourceChange() {
      if (sourceBusy || scanning || saving) return false;

      if (dirty) {
        return window.confirm(
          "현재 측정에 저장하지 않은 변경 사항이 있습니다.\n\n" +
          "새 영상이나 다른 카메라로 바꾸면 현재 측정이 초기화됩니다.\n" +
          "저장하지 않고 새 측정을 시작할까요?"
        );
      }

      if (samples.size || snapshots.length) {
        return window.confirm(
          "촬영 구도가 달라지므로 새 측정을 시작합니다.\n" +
          "이미 저장한 기록은 유지됩니다. 계속할까요?"
        );
      }

      return true;
    }

    async function connectCamera(requestedFacing = facing) {
      if (!confirmSourceChange()) return;

      if (!window.isSecureContext) {
        throw new Error(
          "카메라는 HTTPS 주소 또는 localhost에서 사용할 수 있습니다."
        );
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("이 브라우저에서 카메라 API를 사용할 수 없습니다.");
      }

      sourceBusy = true;
      syncButtons();

      try {
        // 모델 준비에 실패해도 기존 측정은 남겨 둡니다.
        await getModel();
        if (!active) return;

        releaseSource();
        clearMeasurement();

        source = null;
        sourceFile = null;
        sourceName = "";

        status(
          requestedFacing === "user"
            ? "전면 카메라를 연결하는 중입니다…"
            : "후면 카메라를 연결하는 중입니다…"
        );

        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: requestedFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        if (!active) {
          acquired.getTracks().forEach(track => track.stop());
          return;
        }

        stream = acquired;

        const track = stream.getVideoTracks()[0];
        const actualFacing = track.getSettings?.().facingMode;

        facing = actualFacing === "user" ||
          actualFacing === "environment"
          ? actualFacing
          : requestedFacing;

        video.srcObject = stream;
        await video.play();
        await waitForVideo();

        if (!active) return;

        source = "camera";
        sourceName = track.label || "카메라";
        resize();
        startCameraClock();

        $("#an-placeholder").hidden = true;
        $("#an-placeholder").style.display = "none";

        $("#an-camera-label").textContent =
          `연결 카메라: ${
            actualFacing === "user"
              ? "전면"
              : actualFacing === "environment"
                ? "후면"
                : "방향 확인 불가"
          }${track.label ? ` · ${track.label}` : ""}`;

        $("#an-switch").textContent =
          facing === "user"
            ? "후면 카메라로 전환"
            : "전면 카메라로 전환";

        status(
          "카메라 분석 중 · 전면 화면도 좌우 반전 없이 표시합니다."
        );
      } catch (error) {
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          stream = null;
        }
        source = null;
        throw error;
      } finally {
        sourceBusy = false;
        syncButtons();
      }
    }

    async function uploadFile(file) {
      if (!file || !confirmSourceChange()) return;

      sourceBusy = true;
      syncButtons();

      try {
        await getModel();
        if (!active) return;

        releaseSource();
        clearMeasurement();

        source = null;
        sourceFile = file;
        sourceName = file.name;

        objectURL = URL.createObjectURL(file);
        video.src = objectURL;
        video.load();

        await waitForVideo();
        if (!active) return;

        source = "upload";
        resize();

        $("#an-placeholder").hidden = true;
        $("#an-placeholder").style.display = "none";

        if (finite(video.duration)) {
          $("#an-seek").max = String(video.duration);
          $("#an-range-end").value = video.duration.toFixed(1);
        }

        status(`영상 준비 완료 · ${file.name}`);

        detectFrame(true);
        draw();
        updateGraph(true);
      } finally {
        sourceBusy = false;
        syncButtons();
      }
    }

    function detectFrame(force = false) {
      if (
        !active || !model || !source ||
        video.readyState < 2 || inferenceFailed
      ) {
        return;
      }

      const t = currentTime();
      const key = keyOf(t);

      if (!force && key === lastDetectionKey) return;

      lastDetectionKey = key;

      const previous = samples.get(key);

      // 이미 분석한 영상 프레임과 수동 수정값은 유지합니다.
      if (previous && source === "upload") return;

      const result = model.detect(video);
      const raw = result.landmarks?.[0] || [];

      const points = Array.from({ length: 33 }, (_, index) => {
        const point = raw[index];

        return point
          ? {
              x: point.x,
              y: point.y,
              z: point.z,
              visibility: finite(point.visibility)
                ? point.visibility
                : 0
            }
          : null;
      });

      const measured = CM.measurePose(points, width, height);

      samples.set(key, {
        t,
        points,
        angles: measured.angles,
        metrics: measured.metrics,
        manual: false,
        bar: previous?.bar || null
      });

      dirty = true;

      if (samples.size === 1) syncButtons();
    }

    function shownSides() {
      const value = $("#an-side").value;
      return value === "both" ? ["left", "right"] : [value];
    }

    function shownJoints() {
      return [...main.querySelectorAll("[data-joint]:checked")]
        .map(node => node.dataset.joint);
    }

    function pointVisible(index) {
      const selected = $("#an-side").value;

      if (selected === "both") return true;
      return selected === "left"
        ? leftPoints.has(index)
        : rightPoints.has(index);
    }

    function drawSkeleton(points, ghostMode = false) {
      const scale = Math.max(1, width / 800);

      context.lineWidth = 2.5 * scale;
      context.lineCap = "round";

      for (const [a, b] of connections) {
        if (!pointVisible(a) || !pointVisible(b)) continue;
        if (
          !CM.posePointValid(points[a]) ||
          !CM.posePointValid(points[b])
        ) continue;

        context.strokeStyle = ghostMode
          ? "rgba(255,255,255,.35)"
          : leftPoints.has(a) ? "#50daf2" : "#f58cce";

        context.beginPath();
        context.moveTo(points[a].x * width, points[a].y * height);
        context.lineTo(points[b].x * width, points[b].y * height);
        context.stroke();
      }

      for (const [idText] of Object.entries(CM.posePointNames)) {
        const id = Number(idText);
        const point = points[id];

        if (!pointVisible(id) || !CM.posePointValid(point)) continue;

        context.fillStyle = ghostMode
          ? "rgba(255,255,255,.4)"
          : point.manual
            ? "#f5d76e"
            : leftPoints.has(id) ? "#50daf2" : "#f58cce";

        context.beginPath();
        context.arc(
          point.x * width,
          point.y * height,
          3.5 * scale,
          0,
          Math.PI * 2
        );
        context.fill();
      }
    }

    function draw() {
      if (!active) return;

      context.clearRect(0, 0, width, height);

      if (!source) return;

      const scale = Math.max(1, width / 800);
      const time = currentTime();
      const sample = nearestSample(time);

      if ($("#an-guides").checked) {
        const floor = clamp(
          Number($("#an-floor").value) || 0,
          0,
          100
        ) / 100;

        context.save();
        context.strokeStyle = "rgba(255,255,255,.4)";
        context.lineWidth = scale;
        context.setLineDash([7 * scale, 5 * scale]);
        context.beginPath();
        context.moveTo(width / 2, 0);
        context.lineTo(width / 2, height);
        context.moveTo(0, floor * height);
        context.lineTo(width, floor * height);
        context.stroke();
        context.restore();
      }

      if ($("#an-ghost").checked && ghost) {
        drawSkeleton(ghost, true);
      }

      if ($("#an-trails").checked) {
        const trailSamples = sortedSamples().filter(item =>
          item.t >= time - 3 && item.t <= time
        );

        for (const side of shownSides()) {
          const pointId = side === "left" ? 15 : 16;

          context.strokeStyle =
            side === "left" ? "#50daf2" : "#f58cce";
          context.lineWidth = 2 * scale;
          context.beginPath();

          let previous = null;

          for (const item of trailSamples) {
            const point = item.points?.[pointId];

            if (!CM.posePointValid(point)) {
              previous = null;
              continue;
            }

            const x = point.x * width;
            const y = point.y * height;

            if (!previous || item.t - previous.t > 0.8) {
              context.moveTo(x, y);
            } else {
              context.lineTo(x, y);
            }

            previous = item;
          }

          context.stroke();
        }

        context.strokeStyle = "#f5d76e";
        context.beginPath();
        let previousBar = null;

        for (const item of trailSamples) {
          const point = item.bar;

          if (!point || !finite(point.x) || !finite(point.y)) {
            previousBar = null;
            continue;
          }

          if (!previousBar || item.t - previousBar.t > 0.8) {
            context.moveTo(point.x * width, point.y * height);
          } else {
            context.lineTo(point.x * width, point.y * height);
          }

          previousBar = item;
        }

        context.stroke();
      }

      if (!sample) return;

      if ($("#an-skeleton").checked) {
        drawSkeleton(sample.points || []);
      }

      if ($("#an-angles").checked) {
        context.font = `bold ${14 * scale}px sans-serif`;
        context.textBaseline = "middle";

        for (const joint of shownJoints()) {
          for (const side of shownSides()) {
            const value = sample.angles?.[`${side}_${joint}`];
            const pointId = CM.poseJoints[joint][side][1];
            const point = sample.points?.[pointId];

            if (!finite(value) || !CM.posePointValid(point)) continue;

            const text = `${value.toFixed(0)}°`;
            const textWidth = context.measureText(text).width;
            const x = clamp(
              point.x * width + 8 * scale,
              0,
              Math.max(0, width - textWidth - 10 * scale)
            );
            const y = clamp(
              point.y * height,
              12 * scale,
              height - 12 * scale
            );

            context.fillStyle = "rgba(0,0,0,.7)";
            context.fillRect(
              x - 3 * scale,
              y - 10 * scale,
              textWidth + 6 * scale,
              20 * scale
            );

            context.fillStyle =
              side === "left" ? "#50daf2" : "#f58cce";
            context.fillText(text, x, y);
          }
        }
      }

      if (sample.bar) {
        context.strokeStyle = "#f5d76e";
        context.lineWidth = 2 * scale;
        context.beginPath();
        context.arc(
          sample.bar.x * width,
          sample.bar.y * height,
          7 * scale,
          0,
          Math.PI * 2
        );
        context.stroke();
      }
    }

    function repetitionConfig() {
      return {
        key: $("#an-rep-key").value,
        low: Number($("#an-low").value),
        high: Number($("#an-high").value),
        minDuration: 0.5,
        maxGap: 0.8
      };
    }

    function repetitions() {
      if (manualRepetitions.length) {
        return manualRepetitions.slice().sort((a, b) => a.start - b.start);
      }

      if (exercise().mode !== "reps") return [];

      return CM.detectRepetitions(
        sortedSamples(),
        repetitionConfig()
      );
    }

    function updateGraph(force = false) {
      if (!active) return;

      const now = performance.now();
      if (!force && now - lastGraphAt < 650) return;
      lastGraphAt = now;

      const all = sortedSamples();
      const recent = source === "camera"
        ? all.filter(sample => sample.t >= currentTime() - 30)
        : all;

      const series = [];
      const palette = ["#50daf2", "#f58cce", "#f5d76e", "#8ce5ac", "#b8a1ff"];

      shownJoints().forEach((joint, index) => {
        for (const side of shownSides()) {
          series.push({
            name: `${side === "left" ? "왼" : "오른"} ${jointNames[joint]}`,
            color: palette[index % palette.length],
            dash: side === "right" ? "6 4" : undefined,
            data: recent.map(sample => ({
              x: sample.t,
              y: sample.angles?.[`${side}_${joint}`] ?? null
            }))
          });
        }
      });

      $("#an-chart").innerHTML = CM.lineChart(series, {
        unit: "°",
        maxGap: 0.8,
        currentTime: currentTime()
      });

      const current = nearestSample(currentTime());

      $("#an-values").innerHTML = shownJoints().map(joint => `
        <div class="metric">
          <span class="muted">${jointNames[joint]}</span>
          ${shownSides().map(side => {
            const value = current?.angles?.[`${side}_${joint}`];
            return `
              <div style="margin-top:6px">
                ${side === "left" ? "왼쪽" : "오른쪽"}
                <strong>${finite(value) ? value.toFixed(1) + "°" : "—"}</strong>
              </div>
            `;
          }).join("")}
        </div>
      `).join("");

      const reps = repetitions();
      const mode = manualRepetitions.length
        ? "수동"
        : exercise().mode === "reps" ? "자동·실험" : "수동 구간 사용";

      $("#an-rep-count").textContent = `${reps.length}회 · ${mode}`;

      $("#an-rep-list").innerHTML = reps.length
        ? `
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>반복</th><th>시작</th><th>종료</th><th>시간</th></tr>
              </thead>
              <tbody>
                ${reps.slice(-20).map((rep, index) => `
                  <tr>
                    <td>${Math.max(0, reps.length - 20) + index + 1}</td>
                    <td>${rep.start.toFixed(2)}초</td>
                    <td>${rep.end.toFixed(2)}초</td>
                    <td>${(rep.end - rep.start).toFixed(2)}초</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
        : CM.empty("감지하거나 직접 지정한 반복 구간이 없습니다.");
    }

    async function seekTo(time) {
      if (source !== "upload") return;

      const end = finite(video.duration) ? video.duration : time;
      const target = clamp(time, 0, end);

      if (Math.abs(video.currentTime - target) < 0.001 &&
          video.readyState >= 2) {
        return;
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          finish(new Error("영상 탐색 시간이 초과되었습니다."));
        }, 8000);

        function finish(error) {
          clearTimeout(timer);
          video.removeEventListener("seeked", done);
          video.removeEventListener("error", failed);
          signal.removeEventListener("abort", aborted);
          if (error) reject(error);
          else resolve();
        }

        function done() { finish(); }
        function failed() { finish(new Error("영상 탐색에 실패했습니다.")); }
        function aborted() { finish(new Error("분석 화면이 닫혔습니다.")); }

        video.addEventListener("seeked", done, { once: true });
        video.addEventListener("error", failed, { once: true });
        signal.addEventListener("abort", aborted, { once: true });

        video.currentTime = target;
      });
    }

    function readRange() {
      const start = Number($("#an-range-start").value);
      const rawEnd = $("#an-range-end").value;

      const end = rawEnd === ""
        ? video.duration
        : Number(rawEnd);

      if (
        !finite(start) || !finite(end) ||
        start < 0 || end <= start ||
        !finite(video.duration) ||
        end > video.duration + 0.15
      ) {
        throw new Error("영상 길이에 맞는 시작·종료 시간을 입력해 주세요.");
      }

      return { start, end: Math.min(end, video.duration) };
    }

    async function scanVideo() {
      if (source !== "upload" || scanning || saving || sourceBusy) return;

      const range = readRange();

      if (range.end - range.start > 600) {
        throw new Error("한 번에 분석할 구간은 10분 이내로 선택해 주세요.");
      }

      scanning = true;
      cancelScan = false;
      pausePlayback();
      $("#an-edit").value = "none";
      syncButtons();

      try {
        await getModel();

        const total = Math.floor((range.end - range.start) * 10) + 1;

        for (let index = 0; index < total; index++) {
          if (!active || cancelScan) break;

          const time = range.start + index / 10;
          if (time >= video.duration) break;

          await seekTo(time);

          if (!active || cancelScan) break;

          detectFrame(true);
          draw();

          if (index % 5 === 0) {
            status(`구간 분석 중 · ${Math.round((index + 1) / total * 100)}%`);
            updateGraph(true);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        status(cancelScan
          ? "구간 분석을 중단했습니다. 완료된 분석값은 남아 있습니다."
          : "지정 구간 분석을 완료했습니다.");
      } finally {
        scanning = false;
        syncButtons();
        updateGraph(true);
      }
    }

    function renderSnapshots() {
      if (!active) return;

      $("#an-snapshots").innerHTML = snapshots.length
        ? snapshots.map(snapshot => `
          <figure style="margin:0">
            <img src="${esc(snapshot.image)}"
              alt="저장할 동작 사진"
              style="width:100%;border-radius:10px">
            <figcaption class="row spread" style="margin-top:6px">
              <span>${snapshot.t.toFixed(2)}초</span>
              <button class="small"
                data-remove-snapshot="${esc(snapshot.id)}">삭제</button>
            </figcaption>
          </figure>
        `).join("")
        : CM.empty("아직 저장한 사진이 없습니다.");
    }

    function takeSnapshot() {
      if (!source || video.readyState < 2) return;
      if (snapshots.length >= 12) {
        CM.toast("동작 사진은 최대 12장까지 저장할 수 있습니다.");
        return;
      }

      draw();

      const output = document.createElement("canvas");
      const ratio = Math.min(1, 960 / width);
      output.width = Math.round(width * ratio);
      output.height = Math.round(height * ratio);

      const ctx = output.getContext("2d");
      ctx.drawImage(video, 0, 0, output.width, output.height);
      ctx.drawImage(canvas, 0, 0, output.width, output.height);

      snapshots.push({
        id: CM.uid(),
        t: currentTime(),
        image: output.toDataURL("image/jpeg", 0.85)
      });

      dirty = true;
      renderSnapshots();
      CM.toast("동작 사진을 추가했습니다. 분석 저장을 눌러 보관하세요.");
    }

    function pushHistory(key, before, after) {
      history.push({
        key,
        before: before ? clone(before) : null,
        after: after ? clone(after) : null
      });

      if (history.length > 40) history.shift();
      future.length = 0;
      dirty = true;
      syncButtons();
    }

    function applyHistory(item, version) {
      const value = item[version];

      if (value) samples.set(item.key, clone(value));
      else samples.delete(item.key);

      dirty = true;
      draw();
      updateGraph(true);
      syncButtons();
    }

    function editableSample(time) {
      const key = keyOf(time);
      const existing = samples.get(key);

      if (existing) return { key, sample: clone(existing) };

      return {
        key,
        sample: {
          t: time,
          points: Array(33).fill(null),
          angles: {},
          metrics: {},
          manual: true,
          bar: null
        }
      };
    }

    function editAt(event) {
      if (!drag) return;

      const rect = canvas.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const sample = drag.sample;

      if (drag.mode === "bar") {
        sample.bar = { x, y, manual: true };
      } else {
        sample.points[drag.pointId] = {
          x, y, z: 0, visibility: 1, manual: true
        };

        const measured = CM.measurePose(sample.points, width, height);
        sample.angles = measured.angles;
        sample.metrics = measured.metrics;
      }

      sample.manual = true;
      samples.set(drag.key, sample);
      draw();
    }

    function finishDrag() {
      if (!drag) return;

      pushHistory(
        drag.key,
        drag.before,
        samples.get(drag.key)
      );

      drag = null;
      updateGraph(true);
    }

    on("#an-canvas", "pointerdown", event => {
      const mode = $("#an-edit").value;

      if (
        mode === "none" || !source ||
        scanning || saving || sourceBusy
      ) return;

      pausePlayback();

      const time = currentTime();
      const { key, sample } = editableSample(time);

      drag = {
        key,
        sample,
        before: samples.has(key) ? clone(samples.get(key)) : null,
        mode,
        pointId: Number($("#an-point").value)
      };

      canvas.setPointerCapture(event.pointerId);
      editAt(event);
    });

    on("#an-canvas", "pointermove", editAt);
    on("#an-canvas", "pointerup", finishDrag);
    on("#an-canvas", "pointercancel", finishDrag);

    function validOptionalNumber(selector, name) {
      const node = $(selector);

      if (node.value.trim() === "") return null;

      if (!node.checkValidity()) {
        throw new Error(`${name} 입력값을 확인해 주세요.`);
      }

      const value = Number(node.value);
      if (!finite(value)) throw new Error(`${name} 입력값을 확인해 주세요.`);
      return value;
    }

    async function saveRecord(openReport = false) {
      if (saving || scanning || sourceBusy) return;

      if (!samples.size) {
        CM.toast("저장할 분석값이 없습니다.");
        return;
      }

      pausePlayback();
      finishDrag();

      const weight = validOptionalNumber("#an-weight", "중량");
      const targetReps = validOptionalNumber("#an-target", "목표 반복");
      const config = repetitionConfig();

      if (exercise().mode === "reps" &&
          !(config.low >= 0 && config.high <= 180 && config.low < config.high)) {
        throw new Error("반복 기준은 0~180°이며 굽힌 각도가 편 각도보다 작아야 합니다.");
      }

      saving = true;
      syncButtons();

      let newMediaId = null;

      try {
        const all = sortedSamples();
        const athleteId = $("#an-athlete").value;
        const athlete = athletes.find(item => item.id === athleteId);
        const currentExercise = exercise();

        const existing = savedId
          ? await CM.db.get("records", savedId)
          : null;

        if (
          source === "upload" &&
          sourceFile &&
          $("#an-keep-media").checked &&
          !mediaId
        ) {
          newMediaId = CM.uid();

          await CM.db.put("media", {
            id: newMediaId,
            blob: sourceFile,
            name: sourceFile.name,
            type: sourceFile.type,
            createdAt: new Date().toISOString()
          });
        }

        const now = new Date().toISOString();
        const id = savedId || CM.uid();
        const reps = repetitions();

        let range = null;
        if (source === "upload") range = readRange();

        const record = {
          ...(existing || {}),
          id,
          athleteId,
          athleteName: athlete?.name || "게스트",
          exerciseId: currentExercise.id,
          exercise: { ...currentExercise },
          view: $("#an-view").value,
          weight,
          targetReps,
          createdAt: createdAt || existing?.createdAt || now,
          updatedAt: now,
          width,
          height,
          source,
          sourceName,
          duration: source === "upload" && finite(video.duration)
            ? video.duration
            : currentTime(),
          samples: all,
          repetitions: reps,
          repetitionConfig: config,
          repetitionSource: manualRepetitions.length
            ? "manual"
            : currentExercise.mode === "reps"
              ? "experimental-auto"
              : "none",
          range,
          snapshots: snapshots.slice(),
          memo: $("#an-memo").value.trim(),
          coachFeedback: existing?.coachFeedback || "",
          mediaId: newMediaId || mediaId || existing?.mediaId || null,
          measurementVersion: "2d-v1",
          angleDefinition: "three-point-internal-angle",
          barTracking: "manual",
          clinicalValidation: false
        };

        await CM.db.put("records", record);

        savedId = id;
        mediaId = record.mediaId;
        createdAt = record.createdAt;
        newMediaId = null;
        dirty = false;

        CM.selectedRecord = id;
        CM.selectedAthlete = athleteId;
        CM.selectedExercise = currentExercise.id;

        status("分析を保存しました。".replace(
          "分析を保存しました。",
          "분석을 저장했습니다. 재생을 계속하면 변경 사항이 추가됩니다."
        ));

        CM.toast("분석 기록을 저장했습니다.");

        if (openReport) location.hash = "reports";
      } catch (error) {
        if (newMediaId) {
          try {
            await CM.db.remove("media", newMediaId);
          } catch (cleanupError) {
            console.warn(cleanupError);
          }
        }

        throw error;
      } finally {
        saving = false;
        syncButtons();
      }
    }

    on("#an-camera", "click", () => connectCamera(facing));

    on("#an-switch", "click", () =>
      connectCamera(facing === "user" ? "environment" : "user")
    );

    on("#an-file", "change", async event => {
      const file = event.target.files?.[0];
      try {
        await uploadFile(file);
      } finally {
        event.target.value = "";
      }
    });

    on("#an-play", "click", async () => {
      if (!source) return;

      if (!video.paused) {
        pausePlayback();
      } else {
        $("#an-edit").value = "none";

        if (source === "upload" &&
            finite(video.duration) &&
            video.currentTime >= video.duration - 0.05) {
          await seekTo(0);
        }

        await video.play();
        if (source === "camera") startCameraClock();
      }
    });

    on("#an-back", "click", async () => {
      pausePlayback();
      await seekTo(currentTime() - 0.1);
      detectFrame(true);
      draw();
      updateGraph(true);
    });

    on("#an-next", "click", async () => {
      pausePlayback();
      await seekTo(currentTime() + 0.1);
      detectFrame(true);
      draw();
      updateGraph(true);
    });

    on("#an-seek", "change", async event => {
      pausePlayback();
      await seekTo(Number(event.target.value));
      detectFrame(true);
      draw();
      updateGraph(true);
    });

    on("#an-speed", "change", event => {
      video.playbackRate = Number(event.target.value);
    });

    on("#an-video", "seeked", () => {
      if (scanning || sourceBusy) return;
      detectFrame(true);
      draw();
      updateGraph(true);
    });

    on("#an-scan", "click", scanVideo);
    on("#an-cancel", "click", () => { cancelScan = true; });
    on("#an-snapshot", "click", takeSnapshot);
    on("#an-save", "click", () => saveRecord(false));
    on("#an-report", "click", () => saveRecord(true));

    on("#an-memo", "input", () => { dirty = true; });
    on("#an-keep-media", "change", () => {
      if (samples.size) dirty = true;
    });

    on("#an-edit", "change", event => {
      if (event.target.value !== "none") {
        pausePlayback();
        detectFrame(true);
        draw();
      }
    });

    on("#an-undo", "click", () => {
      if (saving || scanning || sourceBusy) return;
      finishDrag();
      const item = history.pop();
      if (!item) return;
      future.push(item);
      applyHistory(item, "before");
    });

    on("#an-redo", "click", () => {
      if (saving || scanning || sourceBusy) return;
      const item = future.pop();
      if (!item) return;
      history.push(item);
      applyHistory(item, "after");
    });

    on("#an-clear-bar", "click", () => {
      if (saving || scanning || sourceBusy) return;
      pausePlayback();

      const key = keyOf(currentTime());
      const sample = samples.get(key);

      if (!sample?.bar) {
        CM.toast("현재 시점에 지정한 바벨 점이 없습니다.");
        return;
      }

      const before = clone(sample);
      sample.bar = null;
      pushHistory(key, before, sample);
      draw();
    });

    on("#an-set-ghost", "click", () => {
      const sample = nearestSample(currentTime());

      if (!sample?.points?.some(CM.posePointValid)) {
        CM.toast("기준으로 사용할 인식된 자세가 없습니다.");
        return;
      }

      ghost = clone(sample.points);
      $("#an-ghost").checked = true;
      draw();
      CM.toast("현재 자세를 화면 비교 기준으로 설정했습니다.");
    });

    on("#an-mark-start", "click", () => {
      if (!source || saving || scanning || sourceBusy) return;

      markStart = currentTime();
      $("#an-mark-label").textContent =
        `시작점 ${markStart.toFixed(2)}초 · 종료 시점을 지정하세요.`;
    });

    on("#an-mark-end", "click", () => {
      if (!source || saving || scanning || sourceBusy) return;
      if (!finite(markStart)) {
        CM.toast("먼저 구간 시작점을 지정해 주세요.");
        return;
      }

      const end = currentTime();

      if (end <= markStart) {
        CM.toast("종료 시점은 시작 시점보다 뒤여야 합니다.");
        return;
      }

      const overlap = manualRepetitions.some(rep =>
        markStart < rep.end && end > rep.start
      );

      if (overlap) {
        CM.toast("기존 수동 반복 구간과 겹칩니다.");
        return;
      }

      manualRepetitions.push({
        start: markStart,
        end,
        duration: end - markStart,
        source: "manual"
      });

      dirty = true;
      markStart = null;
      $("#an-mark-label").textContent = "수동 구간 시작점 없음";
      updateGraph(true);
    });

    on("#an-remove-rep", "click", () => {
      if (saving || scanning || sourceBusy) return;

      if (manualRepetitions.length) {
        manualRepetitions.pop();
        dirty = true;
        updateGraph(true);
      }
    });

    on("#an-clear-reps", "click", () => {
      if (saving || scanning || sourceBusy) return;
      if (!manualRepetitions.length) return;

      if (window.confirm("지정한 수동 반복 구간을 모두 지울까요?")) {
        manualRepetitions.length = 0;
        dirty = true;
        updateGraph(true);
      }
    });

    on("#an-snapshots", "click", event => {
      if (saving || scanning || sourceBusy) return;

      const button = event.target.closest("[data-remove-snapshot]");
      if (!button) return;

      const index = snapshots.findIndex(
        item => item.id === button.dataset.removeSnapshot
      );

      if (index >= 0) {
        snapshots.splice(index, 1);
        dirty = true;
        renderSnapshots();
      }
    });

    for (const selector of [
      "#an-side", "#an-skeleton", "#an-angles",
      "#an-guides", "#an-trails", "#an-ghost", "#an-floor"
    ]) {
      on(selector, "change", () => {
        draw();
        updateGraph(true);
      });
    }

    main.querySelectorAll("[data-joint]").forEach(node => {
      node.addEventListener("change", () => {
        draw();
        updateGraph(true);
      }, { signal });
    });

    for (const selector of ["#an-rep-key", "#an-low", "#an-high"]) {
      on(selector, "change", () => {
        if (samples.size) dirty = true;
        updateGraph(true);
      });
    }

    for (const selector of ["#an-range-start", "#an-range-end"]) {
      on(selector, "change", () => {
        if (samples.size) dirty = true;
      });
    }

    on("#an-exercise", "change", () => {
      const chosen = exercise();
      CM.selectedExercise = chosen.id;

      const metric = Object.hasOwn(jointNames, chosen.metric)
        ? chosen.metric
        : "knee";

      $("#an-rep-key").value = `left_${metric}`;
      updateGraph(true);
    });

    const initialMetric = Object.hasOwn(
      jointNames,
      selectedExercise.metric
    ) ? selectedExercise.metric : "knee";

    $("#an-rep-key").value = `left_${initialMetric}`;

    const unbindChart = CM.bindChartSeek(
      $("#an-chart"),
      async time => {
        if (source !== "upload" || scanning || saving || sourceBusy) return;

        try {
          pausePlayback();
          await seekTo(time);
          detectFrame(true);
          draw();
          updateGraph(true);
        } catch (error) {
          showError(error);
        }
      }
    );

    function frame(now) {
      if (!active) return;

      try {
        if (
          source && !sourceBusy && !scanning && !saving &&
          !video.paused && video.readyState >= 2
        ) {
          if (source === "upload" && $("#an-loop").checked) {
            try {
              const range = readRange();

              if (video.currentTime >= range.end) {
                video.currentTime = range.start;
              }
            } catch {
              $("#an-loop").checked = false;
              CM.toast("반복 재생 구간을 확인해 주세요.");
            }
          }

          if (now - lastDetectAt >= 100) {
            lastDetectAt = now;
            detectFrame();
          }
        }

        if (source === "upload" && !video.seeking) {
          $("#an-seek").value = String(video.currentTime || 0);
        }

        draw();

        if (source && !scanning) {
          updateGraph();
        }
      } catch (error) {
        inferenceFailed = true;
        pausePlayback();
        showError(error);
      }

      raf = requestAnimationFrame(frame);
    }

    function beforeUnload(event) {
      if (!dirty && !saving && !sourceBusy && !scanning) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", beforeUnload, { signal });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        pausePlayback();
        if (scanning) cancelScan = true;
      }
    }, { signal });

    CM.analysisCanLeave = () => {
      if (saving || sourceBusy) {
        CM.toast("진행 중인 작업이 끝난 뒤 이동해 주세요.");
        return false;
      }

      if (scanning) {
        CM.toast("구간 분석을 중단한 뒤 이동해 주세요.");
        return false;
      }

      return !dirty || window.confirm(
        "저장하지 않은 분석값이 있습니다. 저장하지 않고 이동할까요?"
      );
    };

    CM.analysisCleanup = () => {
      active = false;
      cancelScan = true;
      cancelAnimationFrame(raf);
      controller.abort();

      if (typeof unbindChart === "function") unbindChart();

      releaseSource();

      if (model) {
        model.close();
        model = null;
      }

      CM.analysisCanLeave = null;
      CM.analysisCleanup = null;
    };

    syncButtons();
    renderSnapshots();
    updateGraph(true);
    raf = requestAnimationFrame(frame);
  };
})();