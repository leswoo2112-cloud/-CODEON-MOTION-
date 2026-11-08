/*
  실버스타 스포츠 과학원 · CODEON MOTION
  analysis.js — 통합 교체본

  자동 기능
  - 관절 기준점, 각도, 위치, 궤적 계산
  - 일정 간격 유효 프레임 자동 사진 캡처
  - 업로드 영상 지정 구간 분석
  - 분석 완료 후 자동 저장·리포트 이동 선택
  - 카메라 측정 종료 → 저장 → 리포트

  유지 기능
  - Lite / Full / Heavy
  - 전면 / 후면 카메라
  - 관절·좌우 선택
  - 원본 / 표시용 평균선
  - 수동 점 수정 / 바벨 점
  - 실행 취소·다시 실행
  - 수동 반복 구간 / 기준 자세

  주의
  - 카메라 원본 영상은 녹화하지 않습니다.
  - 바벨 자체의 자동 객체 추적은 포함하지 않습니다.
  - 자동 반복 감지는 실험 기능입니다.
*/

(() => {
  "use strict";

  const CM = window.CM = window.CM || {};
  const finite = Number.isFinite;
  const esc = value => CM.escape(String(value ?? ""));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const copy = value => JSON.parse(JSON.stringify(value));

  const joints = {
    shoulder: "어깨",
    elbow: "팔꿈치",
    hip: "고관절",
    knee: "무릎",
    ankle: "발목"
  };

  const parts = {
    ...joints,
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

  CM.poseJoints = {
    shoulder: { left: [23, 11, 13], right: [24, 12, 14] },
    elbow: { left: [11, 13, 15], right: [12, 14, 16] },
    hip: { left: [11, 23, 25], right: [12, 24, 26] },
    knee: { left: [23, 25, 27], right: [24, 26, 28] },
    ankle: { left: [25, 27, 31], right: [26, 28, 32] }
  };

  CM.posePointNames = {
    11: "왼쪽 어깨", 12: "오른쪽 어깨",
    13: "왼쪽 팔꿈치", 14: "오른쪽 팔꿈치",
    15: "왼쪽 손목", 16: "오른쪽 손목",
    23: "왼쪽 고관절", 24: "오른쪽 고관절",
    25: "왼쪽 무릎", 26: "오른쪽 무릎",
    27: "왼쪽 발목", 28: "오른쪽 발목",
    29: "왼쪽 뒤꿈치", 30: "오른쪽 뒤꿈치",
    31: "왼쪽 발끝", 32: "오른쪽 발끝"
  };

  const edges = [
    [11, 12], [11, 13], [13, 15],
    [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28],
    [27, 29], [29, 31], [27, 31],
    [28, 30], [30, 32], [28, 32]
  ];

  const leftIds = new Set([11, 13, 15, 23, 25, 27, 29, 31]);
  const rightIds = new Set([12, 14, 16, 24, 26, 28, 30, 32]);

  const colors = [
    "#50daf2", "#f58cce", "#f5d76e", "#8ce5ac",
    "#b8a1ff", "#ffad75", "#7db5ff", "#dddddd"
  ];

  CM.posePointValid = p => Boolean(
    p &&
    finite(p.x) &&
    finite(p.y) &&
    (p.manual || (finite(p.visibility) && p.visibility >= 0.55))
  );

  CM.angle2D = (a, b, c, width = 1, height = 1) => {
    if (![a, b, c].every(CM.posePointValid)) return null;

    const ux = (a.x - b.x) * width;
    const uy = (a.y - b.y) * height;
    const vx = (c.x - b.x) * width;
    const vy = (c.y - b.y) * height;

    const denominator = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (denominator < 1e-8) return null;

    return Math.acos(
      clamp((ux * vx + uy * vy) / denominator, -1, 1)
    ) * 180 / Math.PI;
  };

  CM.measurePose = (points, width, height) => {
    const angles = {};
    const metrics = {};

    for (const [joint, sides] of Object.entries(CM.poseJoints)) {
      for (const [side, ids] of Object.entries(sides)) {
        angles[`${side}_${joint}`] = CM.angle2D(
          points[ids[0]], points[ids[1]], points[ids[2]],
          width, height
        );
      }
    }

    function tilt(a, b) {
      if (!CM.posePointValid(a) || !CM.posePointValid(b)) return null;

      let angle = Math.atan2(
        (b.y - a.y) * height,
        (b.x - a.x) * width
      ) * 180 / Math.PI;

      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return angle;
    }

    for (const side of ["left", "right"]) {
      const shoulder = points[side === "left" ? 11 : 12];
      const hip = points[side === "left" ? 23 : 24];
      const knee = points[side === "left" ? 25 : 26];
      const toe = points[side === "left" ? 31 : 32];

      metrics[`${side}_trunk`] =
        CM.posePointValid(shoulder) && CM.posePointValid(hip)
          ? Math.atan2(
              Math.abs((shoulder.x - hip.x) * width),
              (hip.y - shoulder.y) * height
            ) * 180 / Math.PI
          : null;

      metrics[`${side}_kneeToe`] =
        CM.posePointValid(knee) && CM.posePointValid(toe)
          ? (knee.x - toe.x) * width
          : null;
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

    const result = [];
    let ready = false;
    let moving = false;
    let start = 0;
    let bottom = 0;
    let minimum = Infinity;
    let previousTime = null;

    for (const sample of samples.slice().sort((a, b) => a.t - b.t)) {
      const value = sample.angles?.[key];

      if (
        !finite(value) ||
        (previousTime !== null && sample.t - previousTime > maxGap)
      ) {
        ready = false;
        moving = false;
        minimum = Infinity;
      }

      previousTime = sample.t;
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
        if (sample.t - start >= minDuration) {
          result.push({
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

        moving = false;
        start = sample.t;
        minimum = Infinity;
      }
    }

    return result;
  };

  function smooth(data) {
    const result = data.map(p => ({ ...p }));
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

      for (let i = start; i <= end; i++) {
        const from = Math.max(start, i - 2);
        const to = Math.min(end, i + 2);
        let sum = 0;

        for (let j = from; j <= to; j++) sum += data[j].y;
        result[i].y = sum / (to - from + 1);
      }

      start = end + 1;
    }

    return result;
  }

  CM.renderAnalysis = async () => {
    CM.analysisCleanup?.();
    await CM.loadExercises();

    const athletes = await CM.db.all("athletes");
    const main = document.querySelector("#main");

    const initialExercise =
      CM.exercises.find(x => x.id === CM.selectedExercise) ||
      CM.exercises[0];

    if (!initialExercise) {
      main.innerHTML = CM.empty("등록된 운동이 없습니다.");
      return;
    }

    const button = (id, label, primary = false) =>
      `<button id="${id}" ${primary ? 'class="primary"' : ""}>${label}</button>`;

    const check = (id, label, checked = false) =>
      `<label><input id="${id}" type="checkbox"
        ${checked ? "checked" : ""}> ${label}</label>`;

    main.innerHTML = `
      ${CM.heading("자세 분석", "SILVERSTAR · AUTOMATIC MOTION ANALYSIS", `
        ${button("an-save", "현재 분석 저장")}
        ${button("an-finish", "측정 종료 · 리포트", true)}
      `)}

      <div class="analysis-layout">
        <aside class="panel">
          <h2>측정 설정</h2>

          <label>선수
            <select id="an-athlete">
              <option value="">게스트</option>
              ${athletes.map(a => `
                <option value="${esc(a.id)}"
                  ${a.id === CM.selectedAthlete ? "selected" : ""}>
                  ${esc(a.name)}
                </option>
              `).join("")}
            </select>
          </label>

          <label style="display:block;margin-top:12px">운동
            <select id="an-exercise">
              ${CM.exercises.map(ex => `
                <option value="${esc(ex.id)}"
                  ${ex.id === initialExercise.id ? "selected" : ""}>
                  ${esc(ex.category)} · ${esc(ex.name)}
                </option>
              `).join("")}
            </select>
          </label>

          <label style="display:block;margin-top:12px">촬영 방향
            <select id="an-view">
              <option value="side">측면</option>
              <option value="front">정면</option>
              <option value="back">후면</option>
            </select>
          </label>

          <div class="grid g2" style="margin-top:12px">
            <label>중량 kg
              <input id="an-weight" type="number"
                min="0" max="1000" step="0.5" placeholder="선택">
            </label>
            <label>목표 반복
              <input id="an-target" type="number"
                min="1" max="9999" step="1" placeholder="선택">
            </label>
          </div>

          <hr>
          <h3>인식 설정</h3>

          <label>모델
            <select id="an-model">
              <option value="lite">Lite · 속도 우선</option>
              <option value="full" selected>Full · 기본</option>
              <option value="heavy">Heavy · 무거운 모델</option>
            </select>
          </label>

          <label style="display:block;margin-top:12px">가시성 필터
            <select id="an-threshold">
              <option value="0.55">기본 · 0.55 이상</option>
              <option value="0.75" selected>엄격 · 0.75 이상</option>
              <option value="0.9">매우 엄격 · 0.90 이상</option>
            </select>
          </label>

          <p class="muted" style="font-size:12px">
            필터 값은 정확도 비율이 아닙니다.
            한 사람만 촬영하세요.
            여러 사람이 감지되면 해당 프레임을 보류합니다.
          </p>

          <div style="display:grid;gap:8px">
            ${button("an-camera", "카메라 연결", true)}
            ${button("an-switch", "전면 / 후면 전환")}
            ${button("an-new", "새 측정 준비")}
          </div>

          <p id="an-camera-label" class="muted">선택 카메라: 후면</p>

          <label>영상 업로드
            <input id="an-file" type="file" accept="video/*">
          </label>

          <div style="margin-top:12px">
            ${check("an-keep-media", "업로드 원본도 저장")}
          </div>

          <p class="muted" style="font-size:12px">
            카메라 원본은 녹화하지 않습니다.
            분석값과 캡처 사진을 저장합니다.
          </p>

          <hr>
          <h3>자동화</h3>

          <div style="display:grid;gap:10px">
            ${check("an-auto-photo", "자동 동작 사진", true)}
            ${check("an-auto-finish", "영상 분석 완료 후 저장·리포트", true)}
          </div>

          <label style="display:block;margin-top:12px">카메라 자동 사진 간격
            <select id="an-photo-interval">
              <option value="3">3초</option>
              <option value="5" selected>5초</option>
              <option value="10">10초</option>
            </select>
          </label>

          <p class="muted" style="font-size:12px">
            사진은 최대 12장입니다.
            자동 사진은 일정 간격의 유효 프레임이며
            동작의 최저점으로 판정한 사진이 아닙니다.
          </p>

          <hr>
          <h3>영상 분석 구간</h3>

          <div class="grid g2">
            <label>시작 초
              <input id="an-start" type="number"
                min="0" value="0" step="0.1">
            </label>
            <label>종료 초
              <input id="an-end" type="number"
                min="0" step="0.1" placeholder="영상 끝">
            </label>
          </div>

          <div style="display:grid;gap:8px;margin-top:12px">
            ${button("an-scan", "지정 구간 자동 분석", true)}
            <button id="an-cancel" hidden>분석 중단</button>
          </div>

          <div style="margin-top:12px">
            ${check("an-loop", "구간 반복 재생")}
          </div>

          <hr>
          <h3>자동 반복 감지 · 실험</h3>

          <label>기준 관절
            <select id="an-rep-key">
              ${Object.entries(joints).map(([key, name]) => `
                <option value="left_${key}">왼쪽 ${name}</option>
                <option value="right_${key}">오른쪽 ${name}</option>
              `).join("")}
            </select>
          </label>

          <div class="grid g2" style="margin-top:10px">
            <label>굽힌 각도 이하
              <input id="an-low" type="number"
                min="0" max="180" value="100">
            </label>
            <label>편 각도 이상
              <input id="an-high" type="number"
                min="0" max="180" value="155">
            </label>
          </div>

          <p class="muted" style="font-size:12px">
            큰 각도 → 작은 각도 → 큰 각도 순서를 감지합니다.
            숫자는 정상 자세 기준이 아닙니다.
            종목에 따라 조정하거나 수동 구간을 사용하세요.
          </p>

          <label>메모
            <textarea id="an-memo" rows="4"></textarea>
          </label>
        </aside>

        <div>
          <section class="panel" style="margin-bottom:18px">
            <div id="an-stage"
              style="position:relative;aspect-ratio:16/9;
                     background:#030b11;overflow:hidden;border-radius:12px">
              <video id="an-video" muted playsinline
                style="width:100%;height:100%;object-fit:fill;display:block">
              </video>
              <canvas id="an-canvas"
                style="position:absolute;inset:0;width:100%;height:100%;
                       touch-action:none"></canvas>
              <div id="an-placeholder"
                style="position:absolute;inset:0;display:grid;
                       place-items:center;pointer-events:none">
                <p class="muted">카메라 또는 영상을 선택하세요.</p>
              </div>
            </div>

            <p id="an-status" role="status" class="muted">측정 준비</p>
            <p id="an-quality" class="muted">관절 인식 대기</p>

            <div class="row" style="gap:8px;flex-wrap:wrap">
              ${button("an-back", "−0.1초")}
              ${button("an-play", "재생 / 정지")}
              ${button("an-next", "+0.1초")}
              <select id="an-speed" aria-label="재생 속도" style="width:auto">
                <option value="0.25">0.25배</option>
                <option value="0.5">0.5배</option>
                <option value="1" selected>1배</option>
                <option value="1.5">1.5배</option>
                <option value="2">2배</option>
              </select>
              ${button("an-snapshot", "사진 직접 추가")}
            </div>

            <input id="an-seek" type="range"
              min="0" max="1" step="0.01" value="0"
              aria-label="영상 시점"
              style="width:100%;margin-top:12px">

            <div class="toggles row"
              style="gap:12px;flex-wrap:wrap;margin-top:12px">
              ${check("an-skeleton", "스켈레톤", true)}
              ${check("an-angles", "각도", true)}
              ${check("an-guides", "기준선", true)}
              ${check("an-trails", "선택 부위 궤적", true)}
              ${check("an-ghost", "기준 자세")}
              ${check("an-only", "선택 부위만")}
            </div>

            <div class="row"
              style="gap:10px;flex-wrap:wrap;margin-top:12px">
              <label>수평 기준선 높이 %
                <input id="an-floor" type="number"
                  min="0" max="100" value="85" style="max-width:120px">
              </label>
              ${button("an-set-ghost", "현재 자세를 기준으로")}
            </div>
          </section>

          <section class="panel" style="margin-bottom:18px">
            <h2>보고 싶은 부위</h2>

            <div class="toggles row" style="gap:12px;flex-wrap:wrap">
              ${Object.entries(parts).map(([key, name]) => `
                <label>
                  <input type="checkbox" data-part="${key}"
                    ${key === "knee" ? "checked" : ""}> ${name}
                </label>
              `).join("")}
            </div>

            <div class="grid g3" style="margin-top:14px">
              <label>방향
                <select id="an-side">
                  <option value="both">좌우 모두</option>
                  <option value="left">왼쪽만</option>
                  <option value="right">오른쪽만</option>
                </select>
              </label>

              <label>그래프 내용
                <select id="an-mode">
                  <option value="angle">각도 변화</option>
                  <option value="x">가로 위치 변화</option>
                  <option value="y">세로 위치 변화</option>
                </select>
              </label>

              <label>선 표시
                <select id="an-smoothing">
                  <option value="raw">원본 측정값</option>
                  <option value="mean">보기용 5표본 평균</option>
                </select>
              </label>
            </div>

            <p id="an-graph-note" class="muted"></p>
            <div id="an-values" class="grid g3"></div>
            <div id="an-chart" class="chart" style="margin-top:14px"></div>

            <p class="muted">
              평균선은 표시용입니다.
              계산·저장·리포트 원본값은 바꾸지 않습니다.
              인식 공백은 연결하지 않습니다.
            </p>
          </section>

          <section class="panel" style="margin-bottom:18px">
            <h2>자동 반복 요약</h2>
            <p id="an-rep-count" class="muted">0회</p>
            <div id="an-rep-bars" class="chart"></div>
            <div id="an-rep-list"></div>
          </section>

          <section class="panel" style="margin-bottom:18px">
            <h2>수동 보정 · 필요한 경우만</h2>

            <div class="grid g2">
              <label>편집 모드
                <select id="an-edit">
                  <option value="none">편집 안 함</option>
                  <option value="joint">관절 기준점 수정</option>
                  <option value="bar">바벨 점 지정</option>
                </select>
              </label>

              <label>수정할 기준점
                <select id="an-point">
                  ${Object.entries(CM.posePointNames).map(([id, name]) => `
                    <option value="${id}">${name}</option>
                  `).join("")}
                </select>
              </label>
            </div>

            <p class="muted">
              편집 모드를 선택한 뒤 위치를 클릭하거나 드래그하세요.
              바벨 자동 추적은 포함하지 않습니다.
            </p>

            <div class="row" style="gap:8px;flex-wrap:wrap">
              ${button("an-undo", "실행 취소")}
              ${button("an-redo", "다시 실행")}
              ${button("an-clear-bar", "현재 바벨 점 삭제")}
            </div>

            <hr>

            <h3>수동 반복 구간</h3>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              ${button("an-mark-start", "현재 시점 시작")}
              ${button("an-mark-end", "현재 시점 종료")}
              ${button("an-remove-rep", "마지막 구간 취소")}
              ${button("an-clear-reps", "수동 구간 지우기")}
            </div>
            <p id="an-mark-label" class="muted">시작점 없음</p>
          </section>

          <section class="panel">
            <h2>리포트에 들어갈 동작 사진</h2>
            <p id="an-photo-status" class="muted">
              자동 캡처 대기 · 최대 12장
            </p>
            <div id="an-snapshots" class="grid g3"></div>
          </section>
        </div>
      </div>
    `;

    const $ = selector => main.querySelector(selector);
    const video = $("#an-video");
    const canvas = $("#an-canvas");
    const ctx = canvas.getContext("2d");
    const controller = new AbortController();
    const signal = controller.signal;

    let active = true;
    let source = null;
    let sourceFile = null;
    let sourceName = "";
    let objectURL = null;
    let stream = null;
    let facing = "environment";

    let model = null;
    let loadedModelName = "";
    let modelPromise = null;

    let width = 1280;
    let height = 720;

    let busy = false;
    let scanning = false;
    let saving = false;
    let finishing = false;
    let cancelScan = false;
    let dirty = false;
    let inferenceFailed = false;

    let cameraElapsed = 0;
    let cameraStartedAt = 0;
    let cameraRunning = false;

    let savedId = null;
    let mediaId = null;
    let createdAt = null;

    let ghost = null;
    let markStart = null;
    let drag = null;

    let raf = 0;
    let lastDetectAt = 0;
    let lastVideoTime = -1;
    let lastGraphAt = 0;
    let revision = 0;
    let cachedRevision = -1;
    let cachedSamples = [];

    let nextCameraPhotoAt = 0;
    let scanPhotoTargets = [];
    let scanPhotoIndex = 0;
    let videoAutoFinished = false;

    const samples = new Map();
    const photos = [];
    const manualReps = [];
    const undo = [];
    const redo = [];

    function on(selector, event, handler) {
      $(selector).addEventListener(event, e => {
        try {
          Promise.resolve(handler(e)).catch(showError);
        } catch (error) {
          showError(error);
        }
      }, { signal });
    }

    function showError(error) {
      console.error(error);
      if (!active) return;

      const messages = {
        NotAllowedError: "카메라 권한을 허용해 주세요.",
        NotFoundError: "사용 가능한 카메라가 없습니다.",
        NotReadableError: "다른 앱의 카메라 사용을 종료하고 다시 시도해 주세요."
      };

      const text = messages[error?.name] ||
        error?.message || "작업 중 오류가 발생했습니다.";

      $("#an-status").textContent = text;
      CM.toast(text, 6000);
    }

    function status(text) {
      if (active) $("#an-status").textContent = text;
    }

    function changed() {
      revision++;
      dirty = true;
    }

    function allSamples() {
      if (cachedRevision !== revision) {
        cachedSamples = [...samples.values()].sort((a, b) => a.t - b.t);
        cachedRevision = revision;
      }
      return cachedSamples;
    }

    function exercise() {
      return CM.exercises.find(x => x.id === $("#an-exercise").value) ||
        initialExercise;
    }

    function keyOf(t) {
      return Math.round(t * 10);
    }

    function timeNow() {
      if (source === "upload") return video.currentTime || 0;
      if (source !== "camera") return 0;

      return cameraElapsed + (
        cameraRunning
          ? (performance.now() - cameraStartedAt) / 1000
          : 0
      );
    }

    function pause() {
      if (source === "camera" && cameraRunning) {
        cameraElapsed = timeNow();
        cameraRunning = false;
      }
      video.pause();
    }

    async function play() {
      await video.play();

      if (source === "camera" && !cameraRunning) {
        cameraStartedAt = performance.now();
        cameraRunning = true;
      }
    }

    function nearest(t) {
      const key = keyOf(t);
      let best = null;
      let distance = Infinity;

      for (let offset = -2; offset <= 2; offset++) {
        const sample = samples.get(key + offset);
        if (!sample) continue;

        const delta = Math.abs(sample.t - t);
        if (delta <= 0.2 && delta < distance) {
          best = sample;
          distance = delta;
        }
      }

      return best;
    }

    function chosenParts() {
      return [...main.querySelectorAll("[data-part]:checked")]
        .map(node => node.dataset.part);
    }

    function sides() {
      const side = $("#an-side").value;
      return side === "both" ? ["left", "right"] : [side];
    }

    function chosenIds() {
      const result = new Set();

      for (const part of chosenParts()) {
        for (const side of sides()) {
          const ids = part === "pelvis"
            ? [23, 24]
            : part === "trunk"
              ? side === "left" ? [11, 23] : [12, 24]
              : CM.poseJoints[part]
                ? CM.poseJoints[part][side]
                : [pointIds[part][side]];

          ids.forEach(id => result.add(id));
        }
      }

      return result;
    }

    function sideAllows(id) {
      const side = $("#an-side").value;
      return side === "both" ||
        (side === "left" ? leftIds.has(id) : rightIds.has(id));
    }

    function center(sample, ids) {
      if (!sample || !ids.every(id =>
        CM.posePointValid(sample.points?.[id])
      )) return null;

      return {
        x: ids.reduce((sum, id) => sum + sample.points[id].x, 0) / ids.length,
        y: ids.reduce((sum, id) => sum + sample.points[id].y, 0) / ids.length
      };
    }

    function partPoint(sample, part, side) {
      if (!sample) return null;
      if (part === "pelvis") return center(sample, [23, 24]);
      if (part === "trunk") {
        return center(sample, side === "left" ? [11, 23] : [12, 24]);
      }

      const p = sample.points?.[pointIds[part][side]];
      return CM.posePointValid(p) ? p : null;
    }

    function partValue(sample, part, side, mode) {
      if (!sample) return null;

      if (mode === "angle") {
        if (part === "wrist") return null;
        if (part === "trunk") return sample.metrics?.[`${side}_trunk`] ?? null;
        if (part === "pelvis") return sample.metrics?.hipTilt ?? null;
        return sample.angles?.[`${side}_${part}`] ?? null;
      }

      const p = partPoint(sample, part, side);
      return p ? (mode === "x" ? p.x : p.y) * 100 : null;
    }

    function locked() {
      return busy || scanning || saving || finishing;
    }

    function syncUI() {
      if (!active) return;

      const lock = locked();
      const measurementStarted = Boolean(source) || samples.size > 0;

      for (const id of [
        "an-camera", "an-switch", "an-new", "an-file",
        "an-save", "an-finish"
      ]) $(`#${id}`).disabled = lock;

      for (const id of [
        "an-athlete", "an-exercise", "an-view", "an-weight", "an-target",
        "an-model", "an-threshold"
      ]) $(`#${id}`).disabled = lock || measurementStarted;

      for (const id of ["an-back", "an-next", "an-seek", "an-speed"]) {
        $(`#${id}`).disabled = lock || source !== "upload";
      }

      for (const id of [
        "an-start", "an-end", "an-rep-key", "an-low", "an-high",
        "an-memo", "an-auto-photo", "an-auto-finish", "an-photo-interval"
      ]) $(`#${id}`).disabled = lock;

      $("#an-play").disabled = lock || !source;
      $("#an-scan").disabled = lock || source !== "upload";
      $("#an-cancel").hidden = !scanning;
      $("#an-edit").disabled = lock || !source;
      $("#an-snapshot").disabled = lock || !source;
      $("#an-keep-media").disabled = lock || source !== "upload";
      $("#an-undo").disabled = lock || !undo.length;
      $("#an-redo").disabled = lock || !redo.length;
    }

    async function ensureModel() {
      const requested = $("#an-model").value;

      if (model && loadedModelName === requested) return model;
      if (modelPromise) return modelPromise;

      status(`${requested.toUpperCase()} 모델을 불러오는 중입니다…`);

      modelPromise = (async () => {
        const vision = await import(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm"
        );

        const files = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
        );

        const next = await vision.PoseLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/" +
              `pose_landmarker/pose_landmarker_${requested}/float16/1/` +
              `pose_landmarker_${requested}.task`,
            delegate: "CPU"
          },
          runningMode: "IMAGE",
          numPoses: 2,
          minPoseDetectionConfidence: 0.6,
          minPosePresenceConfidence: 0.6,
          outputSegmentationMasks: false
        });

        if (!active) {
          next.close();
          throw new Error("분석 화면이 닫혔습니다.");
        }

        model?.close();
        model = next;
        loadedModelName = requested;
        return model;
      })();

      try {
        return await modelPromise;
      } finally {
        modelPromise = null;
      }
    }

    function releaseSource() {
      pause();
      stream?.getTracks().forEach(track => track.stop());
      stream = null;

      video.srcObject = null;
      video.removeAttribute("src");
      video.load();

      if (objectURL) URL.revokeObjectURL(objectURL);

      objectURL = null;
      source = null;
      sourceFile = null;
      sourceName = "";
    }

    function resetMeasurement() {
      samples.clear();
      photos.length = 0;
      manualReps.length = 0;
      undo.length = 0;
      redo.length = 0;
      revision++;

      savedId = null;
      mediaId = null;
      createdAt = null;
      ghost = null;
      markStart = null;
      drag = null;

      cameraElapsed = 0;
      cameraRunning = false;
      lastVideoTime = -1;
      inferenceFailed = false;
      dirty = false;

      nextCameraPhotoAt = 0;
      scanPhotoTargets = [];
      scanPhotoIndex = 0;
      videoAutoFinished = false;

      $("#an-edit").value = "none";
      $("#an-ghost").checked = false;
      $("#an-loop").checked = false;
      $("#an-start").value = "0";
      $("#an-end").value = "";
      $("#an-seek").value = "0";
      $("#an-memo").value = "";
      $("#an-mark-label").textContent = "시작점 없음";
      $("#an-placeholder").style.display = "grid";

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderPhotos();
      updateGraph(true);
    }

    function mayReset() {
      if (locked()) return false;

      if (dirty) {
        return window.confirm(
          "저장하지 않은 측정이 있습니다.\n" +
          "현재 측정을 버리고 새 측정을 시작할까요?"
        );
      }

      if (samples.size || photos.length) {
        return window.confirm(
          "새 측정을 시작할까요? 이미 저장된 기록은 유지됩니다."
        );
      }

      return true;
    }

    function videoEvent(eventName, action, timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("영상 준비 시간이 초과되었습니다.")),
          timeoutMs
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
        function fail() { finish(new Error("영상을 읽을 수 없습니다.")); }
        function abort() { finish(new Error("화면이 닫혔습니다.")); }

        video.addEventListener(eventName, done, { once: true });
        video.addEventListener("error", fail, { once: true });
        signal.addEventListener("abort", abort, { once: true });

        try { action(); } catch (error) { finish(error); }
      });
    }

    async function waitVideo() {
      if (video.readyState >= 2 && video.videoWidth) return;
      await videoEvent("loadeddata", () => {});
    }

    function sizeVideo() {
      width = video.videoWidth;
      height = video.videoHeight;

      if (!width || !height) {
        throw new Error("영상 크기를 확인하지 못했습니다.");
      }

      canvas.width = width;
      canvas.height = height;
      $("#an-stage").style.aspectRatio = `${width}/${height}`;
      $("#an-placeholder").style.display = "none";
    }

    async function openCamera(requested = facing) {
      if (!mayReset()) return;

      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("HTTPS 주소에서 카메라를 실행해 주세요.");
      }

      busy = true;
      syncUI();

      try {
        await ensureModel();
        releaseSource();
        resetMeasurement();

        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: requested },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });

        if (!active) {
          acquired.getTracks().forEach(track => track.stop());
          return;
        }

        stream = acquired;
        video.srcObject = stream;

        await video.play();
        await waitVideo();

        const track = stream.getVideoTracks()[0];
        const actual = track.getSettings?.().facingMode;

        facing = ["user", "environment"].includes(actual)
          ? actual : requested;

        source = "camera";
        sourceName = track.label || "카메라";

        sizeVideo();
        cameraStartedAt = performance.now();
        cameraRunning = true;

        $("#an-camera-label").textContent =
          `연결 카메라: ${
            actual === "user" ? "전면" :
            actual === "environment" ? "후면" : "방향 확인 불가"
          }`;

        $("#an-switch").textContent =
          facing === "user" ? "후면 카메라로 전환" : "전면 카메라로 전환";

        status("카메라 측정 중 · 끝나면 ‘측정 종료 · 리포트’를 누르세요.");
      } catch (error) {
        releaseSource();
        throw error;
      } finally {
        busy = false;
        syncUI();
      }
    }

    async function openFile(file) {
      if (!file || !mayReset()) return;

      busy = true;
      syncUI();

      try {
        await ensureModel();
        releaseSource();
        resetMeasurement();

        objectURL = URL.createObjectURL(file);

        await videoEvent("loadeddata", () => {
          video.src = objectURL;
          video.load();
        });

        source = "upload";
        sourceFile = file;
        sourceName = file.name;
        sizeVideo();

        if (finite(video.duration)) {
          $("#an-seek").max = video.duration;
          $("#an-end").value = video.duration;
        }

        detect();
        status("영상 준비 완료 · 지정 구간 자동 분석을 누르세요.");
      } catch (error) {
        releaseSource();
        throw error;
      } finally {
        busy = false;
        syncUI();
        draw();
        updateGraph(true);
      }
    }

    function detect() {
      if (
        !active || !source || !model ||
        inferenceFailed || video.readyState < 2 || video.seeking
      ) return null;

      const t = timeNow();
      const key = keyOf(t);
      const existing = samples.get(key);

      if (existing) return existing;

      const result = model.detect(video);
      const detected = result.landmarks || [];
      const count = detected.length;
      const threshold = Number($("#an-threshold").value);

      const rawPoints = count === 1
        ? detected[0].map(p => ({
            x: p.x,
            y: p.y,
            z: p.z,
            visibility: finite(p.visibility) ? p.visibility : 0
          }))
        : Array(33).fill(null);

      const points = rawPoints.map(p =>
        p && p.visibility >= threshold ? { ...p } : null
      );

      const measured = CM.measurePose(points, width, height);

      const sample = {
        t,
        rawPoints,
        points,
        angles: measured.angles,
        metrics: measured.metrics,
        manual: false,
        bar: null,
        quality: {
          detectedPeople: count,
          visibilityThreshold: threshold,
          status: count === 0
            ? "no-person"
            : count > 1 ? "multiple-people" : "single-person"
        }
      };

      samples.set(key, sample);
      changed();

      if (samples.size === 1) syncUI();
      return sample;
    }

    function drawSkeleton(points, ghostMode = false) {
      const selected = chosenIds();
      const only = $("#an-only").checked;
      const scale = Math.max(1, width / 800);

      for (const [a, b] of edges) {
        if (!sideAllows(a) || !sideAllows(b)) continue;
        if (only && !(selected.has(a) && selected.has(b))) continue;
        if (![points[a], points[b]].every(CM.posePointValid)) continue;

        ctx.strokeStyle = ghostMode
          ? "rgba(255,255,255,.3)"
          : selected.has(a) && selected.has(b)
            ? "#f5d76e"
            : leftIds.has(a) ? "#50daf2" : "#f58cce";

        ctx.lineWidth = 2.5 * scale;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(points[a].x * width, points[a].y * height);
        ctx.lineTo(points[b].x * width, points[b].y * height);
        ctx.stroke();
      }

      for (const text of Object.keys(CM.posePointNames)) {
        const id = Number(text);
        const p = points[id];

        if (
          !sideAllows(id) ||
          !CM.posePointValid(p) ||
          (only && !selected.has(id))
        ) continue;

        ctx.fillStyle = ghostMode
          ? "rgba(255,255,255,.4)"
          : p.manual || selected.has(id)
            ? "#f5d76e"
            : leftIds.has(id) ? "#50daf2" : "#f58cce";

        ctx.beginPath();
        ctx.arc(
          p.x * width, p.y * height,
          (selected.has(id) ? 5 : 3) * scale,
          0, Math.PI * 2
        );
        ctx.fill();
      }
    }

    function drawTrail(list, getter, color) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, width / 500);
      ctx.beginPath();

      let previous = null;

      for (const sample of list) {
        const p = getter(sample);

        if (!p || !finite(p.x) || !finite(p.y)) {
          previous = null;
          continue;
        }

        if (previous === null || sample.t - previous > 0.8) {
          ctx.moveTo(p.x * width, p.y * height);
        } else {
          ctx.lineTo(p.x * width, p.y * height);
        }

        previous = sample.t;
      }

      ctx.stroke();
    }

    function draw() {
      if (!active) return;

      ctx.clearRect(0, 0, width, height);
      if (!source) return;

      const scale = Math.max(1, width / 800);
      const t = timeNow();
      const sample = nearest(t);

      if ($("#an-guides").checked) {
        const floor = clamp(Number($("#an-floor").value) || 0, 0, 100) / 100;

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.lineWidth = scale;
        ctx.setLineDash([7 * scale, 5 * scale]);
        ctx.beginPath();
        ctx.moveTo(width / 2, 0);
        ctx.lineTo(width / 2, height);
        ctx.moveTo(0, floor * height);
        ctx.lineTo(width, floor * height);
        ctx.stroke();
        ctx.restore();
      }

      if ($("#an-ghost").checked && ghost) drawSkeleton(ghost, true);

      if ($("#an-trails").checked) {
        const recent = allSamples().filter(s => s.t >= t - 3 && s.t <= t);

        chosenParts().forEach((part, index) => {
          for (const side of part === "pelvis" ? ["left"] : sides()) {
            drawTrail(
              recent,
              item => partPoint(item, part, side),
              colors[index % colors.length]
            );
          }
        });

        drawTrail(recent, item => item.bar, "#f5d76e");
      }

      if (!sample) return;
      if ($("#an-skeleton").checked) drawSkeleton(sample.points);

      if ($("#an-angles").checked) {
        ctx.font = `bold ${14 * scale}px sans-serif`;
        ctx.textBaseline = "middle";

        for (const part of chosenParts()) {
          if (part === "wrist") continue;

          for (const side of part === "pelvis" ? ["left"] : sides()) {
            const value = partValue(sample, part, side, "angle");
            const p = partPoint(sample, part, side);

            if (!p || !finite(value)) continue;

            const text = `${value.toFixed(0)}°`;
            const textWidth = ctx.measureText(text).width;

            const x = clamp(
              p.x * width + 8 * scale,
              0, Math.max(0, width - textWidth - 8 * scale)
            );

            const y = clamp(
              p.y * height, 12 * scale, height - 12 * scale
            );

            ctx.fillStyle = "rgba(0,0,0,.7)";
            ctx.fillRect(
              x - 3 * scale, y - 10 * scale,
              textWidth + 6 * scale, 20 * scale
            );

            ctx.fillStyle = "#f5d76e";
            ctx.fillText(text, x, y);
          }
        }
      }

      if (sample.bar) {
        ctx.strokeStyle = "#f5d76e";
        ctx.lineWidth = 2 * scale;
        ctx.beginPath();
        ctx.arc(
          sample.bar.x * width,
          sample.bar.y * height,
          7 * scale, 0, Math.PI * 2
        );
        ctx.stroke();
      }
    }

    function repConfig() {
      return {
        key: $("#an-rep-key").value,
        low: Number($("#an-low").value),
        high: Number($("#an-high").value),
        minDuration: 0.5,
        maxGap: 0.8
      };
    }

    function repetitions() {
      if (manualReps.length) {
        return manualReps.slice().sort((a, b) => a.start - b.start);
      }

      if (exercise().mode !== "reps") return [];
      return CM.detectRepetitions(allSamples(), repConfig());
    }

    function updateGraph(force = false) {
      if (!active) return;

      const now = performance.now();
      if (!force && now - lastGraphAt < 800) return;
      lastGraphAt = now;

      const t = timeNow();
      const current = nearest(t);
      const mode = $("#an-mode").value;
      const meanMode = $("#an-smoothing").value === "mean";
      const unit = mode === "angle" ? "°" : "%";

      const list = source === "camera"
        ? allSamples().filter(sample => sample.t >= t - 30)
        : allSamples();

      const chartSeries = [];

      chosenParts().forEach((part, index) => {
        for (const side of part === "pelvis" ? ["left"] : sides()) {
          if (mode === "angle" && part === "wrist") continue;

          const data = list.map(sample => ({
            x: sample.t,
            y: partValue(sample, part, side, mode)
          }));

          chartSeries.push({
            name:
              (part === "pelvis" ? "" : side === "left" ? "왼 " : "오른 ") +
              parts[part],
            color: colors[index % colors.length],
            dash: side === "right" ? "6 4" : undefined,
            data: meanMode ? smooth(data) : data
          });
        }
      });

      $("#an-chart").innerHTML = chartSeries.length
        ? CM.lineChart(chartSeries, {
            unit, maxGap: 0.8, currentTime: t
          })
        : CM.empty(
            chosenParts().includes("wrist") && mode === "angle"
              ? "손목은 가로·세로 위치 그래프를 선택하세요."
              : "보고 싶은 부위를 선택하세요."
          );

      $("#an-graph-note").textContent = mode === "angle"
        ? "관절은 2D 내부각, 몸통은 수직선 기준, 골반은 영상상 골반선 기울기입니다."
        : mode === "x"
          ? "영상 왼쪽 0% → 오른쪽 100%. 실제 거리(cm)가 아닙니다."
          : "영상 위쪽 0% → 아래쪽 100%. 실제 높이(cm)가 아닙니다.";

      $("#an-values").innerHTML = chosenParts().map(part => `
        <div class="metric">
          <strong>${parts[part]}</strong>
          ${(part === "pelvis" ? ["left"] : sides()).map(side => {
            const value = partValue(current, part, side, mode);

            return `<p>
              ${part === "pelvis" ? "" : side === "left" ? "왼쪽 " : "오른쪽 "}
              ${finite(value) ? value.toFixed(1) + unit : "측정 부족"}
            </p>`;
          }).join("")}
        </div>
      `).join("");

      if (current) {
        const count = Object.keys(CM.posePointNames).filter(id =>
          CM.posePointValid(current.points?.[Number(id)])
        ).length;

        const quality = current.quality?.status;

        $("#an-quality").textContent =
          quality === "multiple-people" && !current.manual
            ? "여러 사람이 감지되어 해당 프레임 측정을 보류했습니다."
            : quality === "no-person" && !current.manual
              ? "사람을 충분히 인식하지 못했습니다."
              : `주요 기준점 ${count}/16개 사용 가능` +
                (current.manual ? " · 수동 수정 포함" : "") +
                " · 정확도 비율이 아닙니다.";
      } else {
        $("#an-quality").textContent = "현재 시점의 측정 표본이 없습니다.";
      }

      const reps = repetitions();

      $("#an-rep-count").textContent =
        `${reps.length}회 · ${
          manualReps.length
            ? "수동 구간"
            : exercise().mode === "reps"
              ? "자동 감지·실험"
              : "수동 구간 사용"
        }`;

      $("#an-rep-bars").innerHTML = reps.length
        ? CM.barChart(reps.slice(-20).map((rep, index) => ({
            label: `${Math.max(0, reps.length - 20) + index + 1}회`,
            name: `${Math.max(0, reps.length - 20) + index + 1}회`,
            value: rep.end - rep.start,
            color: "#f58cce"
          })), "s")
        : CM.empty("반복이 저장되면 수행 시간 막대 그래프가 생성됩니다.");

      $("#an-rep-list").innerHTML = reps.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>반복</th><th>시작</th><th>종료</th><th>시간</th>
            </tr></thead>
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
      ` : "";
    }

    function renderPhotos() {
      if (!active) return;

      $("#an-photo-status").textContent =
        `${photos.length}/12장 · ` +
        `${photos.filter(p => p.captureType === "automatic").length}장 자동 캡처`;

      $("#an-snapshots").innerHTML = photos.length
        ? photos.map(photo => `
          <figure style="margin:0">
            <img src="${esc(photo.image)}" alt="동작 사진"
              style="width:100%;border-radius:10px">
            <figcaption class="row spread" style="gap:8px">
              <span>
                ${photo.captureType === "automatic" ? "자동" : "직접"}
                · ${photo.t.toFixed(2)}초
              </span>
              <button data-remove-photo="${esc(photo.id)}">삭제</button>
            </figcaption>
          </figure>
        `).join("")
        : CM.empty("유효한 자세가 인식되면 자동 사진이 추가됩니다.");
    }

    function capturePhoto(type = "manual", finalFrame = false) {
      if (!source || video.readyState < 2 || video.seeking) return false;

      const t = timeNow();
      const sample = nearest(t);

      if (type === "automatic") {
        if (!sample || sample.quality?.status !== "single-person") return false;

        const validCount = Object.keys(CM.posePointNames).filter(id =>
          CM.posePointValid(sample.points?.[Number(id)])
        ).length;

        if (validCount < 6) return false;
        if (Math.abs(sample.t - t) > 0.12) return false;

        if (photos.some(photo =>
          photo.captureType === "automatic" && Math.abs(photo.t - t) < 0.3
        )) return true;
      }

      let replaceIndex = -1;

      if (photos.length >= 12) {
        if (type === "automatic" && finalFrame) {
          for (let i = photos.length - 1; i >= 0; i--) {
            if (photos[i].captureType === "automatic") {
              replaceIndex = i;
              break;
            }
          }
        }

        if (replaceIndex < 0) {
          if (type === "manual") CM.toast("사진은 최대 12장입니다.");
          return false;
        }
      }

      draw();

      const output = document.createElement("canvas");
      const ratio = Math.min(1, 960 / width);
      output.width = Math.round(width * ratio);
      output.height = Math.round(height * ratio);

      const context = output.getContext("2d");
      context.drawImage(video, 0, 0, output.width, output.height);
      context.drawImage(canvas, 0, 0, output.width, output.height);

      const photo = {
        id: CM.uid(),
        t,
        image: output.toDataURL("image/jpeg", 0.82),
        captureType: type,
        captureLabel: type === "automatic"
          ? finalFrame ? "종료 부근 유효 프레임" : "시간 간격 유효 프레임"
          : "직접 캡처"
      };

      if (replaceIndex >= 0) photos[replaceIndex] = photo;
      else photos.push(photo);

      dirty = true;
      renderPhotos();

      if (type === "manual") {
        CM.toast("사진을 추가했습니다. 분석 저장 시 함께 보관합니다.");
      }

      return true;
    }

    function maybeAutoPhoto() {
      if (!$("#an-auto-photo").checked || !source) return;

      const t = timeNow();

      if (scanning) {
        if (
          scanPhotoIndex < scanPhotoTargets.length &&
          t >= scanPhotoTargets[scanPhotoIndex] &&
          capturePhoto("automatic")
        ) {
          // 이미 지나간 목표 시점을 한 번에 정리합니다.
          while (
            scanPhotoIndex < scanPhotoTargets.length &&
            scanPhotoTargets[scanPhotoIndex] <= t
          ) scanPhotoIndex++;
        }

        return;
      }

      if (video.paused || photos.length >= 11) return;

      if (t >= nextCameraPhotoAt && capturePhoto("automatic")) {
        const interval = source === "camera"
          ? Number($("#an-photo-interval").value)
          : finite(video.duration)
            ? Math.max(1, video.duration / 10)
            : 5;

        nextCameraPhotoAt = t + interval;
      }
    }

    function getRange() {
      const start = Number($("#an-start").value);
      const end = $("#an-end").value === ""
        ? video.duration : Number($("#an-end").value);

      if (
        !finite(video.duration) ||
        !finite(start) || !finite(end) ||
        start < 0 || end <= start || end > video.duration + 0.05
      ) {
        throw new Error("영상 길이에 맞는 시작·종료 시간을 입력해 주세요.");
      }

      return { start, end: Math.min(end, video.duration) };
    }

    async function seek(t) {
      if (source !== "upload") return;

      const target = clamp(t, 0, video.duration);

      if (
        Math.abs(video.currentTime - target) < 0.001 &&
        video.readyState >= 2
      ) return;

      await videoEvent("seeked", () => {
        video.currentTime = target;
      }, 8000);
    }

    async function scanVideo() {
      if (source !== "upload" || locked()) return;

      const range = getRange();

      if (range.end - range.start > 600) {
        throw new Error("한 번에 분석할 구간은 10분 이내로 선택하세요.");
      }

      scanning = true;
      cancelScan = false;
      inferenceFailed = false;
      pause();
      $("#an-edit").value = "none";

      const duration = range.end - range.start;

      scanPhotoTargets = Array.from({ length: 11 }, (_, index) =>
        range.start + duration * index / 11
      );

      scanPhotoIndex = 0;
      syncUI();

      let complete = false;

      try {
        await ensureModel();

        const total = Math.max(1, Math.ceil(duration * 10));

        for (let index = 0; index < total; index++) {
          if (!active || cancelScan) break;

          const t = range.start + index / 10;
          if (t >= range.end) break;

          await seek(t);
          if (!active || cancelScan) break;

          detect();
          maybeAutoPhoto();

          if (index % 5 === 0) {
            draw();
            updateGraph(true);
            status(`구간 분석 ${Math.round((index + 1) / total * 100)}%`);
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        complete = active && !cancelScan;

        if (complete && $("#an-auto-photo").checked) {
          capturePhoto("automatic", true);
        }

        status(complete
          ? "지정 구간 분석 완료"
          : "분석을 중단했습니다. 완료된 분석값은 유지합니다.");
      } catch (error) {
        inferenceFailed = true;
        throw error;
      } finally {
        scanning = false;
        syncUI();
        draw();
        updateGraph(true);
      }

      if (complete && $("#an-auto-finish").checked) {
        await finishMeasurement();
      }
    }

    function rememberEdit(key, before, after) {
      undo.push({
        key,
        before: before ? copy(before) : null,
        after: after ? copy(after) : null
      });

      if (undo.length > 40) undo.shift();
      redo.length = 0;
      changed();
      syncUI();
    }

    function finishDrag() {
      if (!drag) return;

      rememberEdit(drag.key, drag.before, samples.get(drag.key));
      drag = null;
      updateGraph(true);
    }

    function editAt(event) {
      if (!drag) return;

      const rect = canvas.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);

      if (drag.mode === "bar") {
        drag.sample.bar = { x, y, manual: true };
      } else {
        drag.sample.points[drag.point] = {
          x, y, z: 0, visibility: 1, manual: true
        };

        const measured = CM.measurePose(drag.sample.points, width, height);
        drag.sample.angles = measured.angles;
        drag.sample.metrics = measured.metrics;
      }

      drag.sample.manual = true;
      samples.set(drag.key, drag.sample);
      revision++;
      draw();
    }

    function applyEdit(item, version) {
      if (item[version]) samples.set(item.key, copy(item[version]));
      else samples.delete(item.key);

      changed();
      syncUI();
      draw();
      updateGraph(true);
    }

    function optionalNumber(selector) {
      const node = $(selector);
      if (node.value.trim() === "") return null;

      if (!node.checkValidity() || !finite(Number(node.value))) {
        throw new Error("중량 또는 목표 반복 입력값을 확인해 주세요.");
      }

      return Number(node.value);
    }

    async function saveRecord() {
      if (busy || scanning || saving) return false;

      if (!samples.size) {
        CM.toast("저장할 분석값이 없습니다.");
        return false;
      }

      pause();
      finishDrag();

      const weight = optionalNumber("#an-weight");
      const targetReps = optionalNumber("#an-target");
      const config = repConfig();

      if (
        exercise().mode === "reps" &&
        !(config.low >= 0 && config.high <= 180 && config.low < config.high)
      ) {
        throw new Error("자동 반복 감지 각도 기준을 확인해 주세요.");
      }

      const range = source === "upload" ? getRange() : null;
      saving = true;
      syncUI();

      let newMediaId = null;

      try {
        const previous = savedId
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

        const athleteId = $("#an-athlete").value;
        const athlete = athletes.find(a => a.id === athleteId);
        const selectedExercise = exercise();
        const now = new Date().toISOString();

        const record = {
          ...(previous || {}),
          id: savedId || CM.uid(),
          athleteId,
          athleteName: athlete?.name || "게스트",
          exerciseId: selectedExercise.id,
          exercise: { ...selectedExercise },
          view: $("#an-view").value,
          weight,
          targetReps,
          createdAt: createdAt || previous?.createdAt || now,
          updatedAt: now,
          width,
          height,
          source,
          sourceName,
          duration: source === "upload" ? video.duration : timeNow(),
          samples: allSamples(),
          repetitions: repetitions(),
          repetitionConfig: config,
          repetitionSource: manualReps.length
            ? "manual"
            : selectedExercise.mode === "reps" ? "experimental-auto" : "none",
          range,
          snapshots: photos.slice(),
          memo: $("#an-memo").value.trim(),
          coachFeedback: previous?.coachFeedback || "",
          mediaId: newMediaId || mediaId || previous?.mediaId || null,
          measurementVersion: "2d-v2",
          angleDefinition: "three-point-internal-angle",
          barTracking: "manual",
          clinicalValidation: false,
          poseConfig: {
            packageVersion: "0.10.18",
            model: loadedModelName,
            runningMode: "IMAGE",
            visibilityThreshold: Number($("#an-threshold").value),
            maxDetectedPeople: 2,
            multiplePeoplePolicy: "skip",
            rawPointsStored: true,
            measurementSmoothing: false,
            plannedSampleRate: 10
          },
          captureConfig: {
            automaticEnabled: $("#an-auto-photo").checked,
            cameraIntervalSeconds: Number($("#an-photo-interval").value),
            type: "time-sampled-valid-frames",
            maxPhotos: 12
          }
        };

        await CM.db.put("records", record);

        savedId = record.id;
        mediaId = record.mediaId;
        createdAt = record.createdAt;
        newMediaId = null;
        dirty = false;

        CM.selectedRecord = record.id;
        CM.selectedAthlete = athleteId;
        CM.selectedExercise = selectedExercise.id;

        status("분석값과 동작 사진을 저장했습니다.");
        CM.toast("분석 기록을 저장했습니다.");
        return true;
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
        syncUI();
      }
    }

    async function finishMeasurement() {
      if (locked()) return;

      finishing = true;
      syncUI();
      let completed = false;

      try {
        pause();
        finishDrag();

        if ($("#an-auto-photo").checked) {
          capturePhoto("automatic", true);
        }

        completed = await saveRecord();
      } finally {
        finishing = false;
        syncUI();
      }

      if (completed && active) {
        location.hash = "reports";
      }
    }

    on("#an-camera", "click", () => openCamera(facing));

    on("#an-switch", "click", () =>
      openCamera(facing === "user" ? "environment" : "user")
    );

    on("#an-new", "click", () => {
      if (!mayReset()) return;
      releaseSource();
      resetMeasurement();
      syncUI();
      status("새 측정 준비 · 모델과 인식 기준을 변경할 수 있습니다.");
    });

    on("#an-file", "change", async event => {
      try {
        await openFile(event.target.files?.[0]);
      } finally {
        event.target.value = "";
      }
    });

    on("#an-play", "click", async () => {
      if (!source) return;

      if (!video.paused) {
        pause();
        return;
      }

      $("#an-edit").value = "none";
      videoAutoFinished = false;

      if (source === "upload" && video.currentTime >= video.duration - 0.05) {
        await seek($("#an-loop").checked ? getRange().start : 0);
      }

      await play();
    });

    async function step(delta) {
      if (source !== "upload" || locked()) return;
      pause();
      await seek(timeNow() + delta);
      detect();
      draw();
      updateGraph(true);
    }

    on("#an-back", "click", () => step(-0.1));
    on("#an-next", "click", () => step(0.1));

    on("#an-seek", "change", async event => {
      if (locked()) return;
      pause();
      await seek(Number(event.target.value));
      detect();
      draw();
      updateGraph(true);
    });

    on("#an-speed", "change", event => {
      video.playbackRate = Number(event.target.value);
    });

    on("#an-video", "seeked", () => {
      if (locked()) return;
      detect();
      draw();
      updateGraph(true);
    });

    on("#an-video", "ended", async () => {
      if (source !== "upload" || locked()) return;

      if ($("#an-loop").checked) {
        await seek(getRange().start);
        await play();
        return;
      }

      if ($("#an-auto-finish").checked && !videoAutoFinished) {
        videoAutoFinished = true;
        await finishMeasurement();
      }
    });

    on("#an-scan", "click", scanVideo);
    on("#an-cancel", "click", () => { cancelScan = true; });
    on("#an-save", "click", () => saveRecord());
    on("#an-finish", "click", finishMeasurement);
    on("#an-snapshot", "click", () => capturePhoto("manual"));

    on("#an-memo", "input", () => { dirty = true; });

    on("#an-edit", "change", event => {
      if (event.target.value !== "none") {
        pause();
        detect();
        draw();
        updateGraph(true);
      }
    });

    on("#an-canvas", "pointerdown", event => {
      const mode = $("#an-edit").value;
      if (!source || mode === "none" || locked()) return;

      pause();

      const t = timeNow();
      const key = keyOf(t);
      const previous = samples.get(key);

      const sample = previous ? copy(previous) : {
        t,
        rawPoints: Array(33).fill(null),
        points: Array(33).fill(null),
        angles: {},
        metrics: {},
        manual: true,
        bar: null,
        quality: { status: "manual" }
      };

      drag = {
        key,
        before: previous ? copy(previous) : null,
        sample,
        mode,
        point: Number($("#an-point").value)
      };

      canvas.setPointerCapture(event.pointerId);
      editAt(event);
    });

    on("#an-canvas", "pointermove", editAt);
    on("#an-canvas", "pointerup", finishDrag);
    on("#an-canvas", "pointercancel", finishDrag);
    on("#an-canvas", "lostpointercapture", finishDrag);

    on("#an-undo", "click", () => {
      if (locked()) return;
      finishDrag();
      const item = undo.pop();
      if (!item) return;
      redo.push(item);
      applyEdit(item, "before");
    });

    on("#an-redo", "click", () => {
      if (locked()) return;
      const item = redo.pop();
      if (!item) return;
      undo.push(item);
      applyEdit(item, "after");
    });

    on("#an-clear-bar", "click", () => {
      if (locked()) return;
      pause();

      const key = keyOf(timeNow());
      const sample = samples.get(key);

      if (!sample?.bar) {
        CM.toast("현재 시점에 바벨 점이 없습니다.");
        return;
      }

      const before = copy(sample);
      sample.bar = null;
      rememberEdit(key, before, sample);
      draw();
    });

    on("#an-set-ghost", "click", () => {
      const sample = nearest(timeNow());

      if (!sample?.points?.some(CM.posePointValid)) {
        CM.toast("기준으로 사용할 자세가 없습니다.");
        return;
      }

      ghost = copy(sample.points);
      $("#an-ghost").checked = true;
      draw();
    });

    on("#an-mark-start", "click", () => {
      if (!source || locked()) return;
      markStart = timeNow();
      $("#an-mark-label").textContent = `시작 ${markStart.toFixed(2)}초`;
    });

    on("#an-mark-end", "click", () => {
      if (!source || locked()) return;
      const end = timeNow();

      if (!finite(markStart) || end <= markStart) {
        CM.toast("시작점보다 뒤의 종료 시점을 선택하세요.");
        return;
      }

      if (manualReps.some(rep => markStart < rep.end && end > rep.start)) {
        CM.toast("다른 수동 구간과 겹칩니다.");
        return;
      }

      manualReps.push({
        start: markStart,
        end,
        duration: end - markStart,
        source: "manual"
      });

      markStart = null;
      dirty = true;
      $("#an-mark-label").textContent = "시작점 없음";
      updateGraph(true);
    });

    on("#an-remove-rep", "click", () => {
      if (locked() || !manualReps.length) return;
      manualReps.pop();
      dirty = true;
      updateGraph(true);
    });

    on("#an-clear-reps", "click", () => {
      if (locked() || !manualReps.length) return;
      if (!window.confirm("수동 구간을 모두 지울까요?")) return;

      manualReps.length = 0;
      dirty = true;
      updateGraph(true);
    });

    on("#an-snapshots", "click", event => {
      if (locked()) return;

      const button = event.target.closest("[data-remove-photo]");
      if (!button) return;

      const index = photos.findIndex(p => p.id === button.dataset.removePhoto);

      if (index >= 0) {
        photos.splice(index, 1);
        dirty = true;
        renderPhotos();
      }
    });

    for (const id of [
      "an-side", "an-mode", "an-smoothing",
      "an-skeleton", "an-angles", "an-guides",
      "an-trails", "an-ghost", "an-only", "an-floor"
    ]) {
      on(`#${id}`, "change", () => {
        draw();
        updateGraph(true);
      });
    }

    main.querySelectorAll("[data-part]").forEach(node => {
      node.addEventListener("change", () => {
        draw();
        updateGraph(true);
      }, { signal });
    });

    for (const id of [
      "an-rep-key", "an-low", "an-high",
      "an-start", "an-end", "an-keep-media"
    ]) {
      on(`#${id}`, "change", () => {
        if (samples.size) dirty = true;
        updateGraph(true);
      });
    }

    on("#an-auto-photo", "change", () => {
      nextCameraPhotoAt = timeNow();
    });

    function chooseExerciseMetric() {
      const selected = exercise();
      const metric = Object.hasOwn(joints, selected.metric)
        ? selected.metric : "knee";

      CM.selectedExercise = selected.id;
      $("#an-rep-key").value = `left_${metric}`;

      main.querySelectorAll("[data-part]").forEach(node => {
        node.checked = node.dataset.part === metric;
      });

      updateGraph(true);
    }

    on("#an-exercise", "change", chooseExerciseMetric);

    const unbindChart = CM.bindChartSeek($("#an-chart"), async t => {
      if (source !== "upload" || locked()) return;

      try {
        pause();
        await seek(t);
        detect();
        draw();
        updateGraph(true);
      } catch (error) {
        showError(error);
      }
    });

    function tick(now) {
      if (!active) return;

      try {
        if (
          source && !locked() &&
          !video.paused && !video.seeking && video.readyState >= 2
        ) {
          if (source === "upload" && $("#an-loop").checked) {
            try {
              const range = getRange();

              if (
                video.currentTime >= range.end ||
                video.currentTime < range.start
              ) {
                video.currentTime = range.start;
              }
            } catch {
              $("#an-loop").checked = false;
              CM.toast("반복 재생 구간을 확인해 주세요.");
            }
          }

          if (
            now - lastDetectAt >= 100 &&
            video.currentTime !== lastVideoTime
          ) {
            lastDetectAt = now;
            lastVideoTime = video.currentTime;
            detect();
            maybeAutoPhoto();
          }
        }

        if (source === "upload" && !video.seeking) {
          $("#an-seek").value = video.currentTime;
        }

        draw();
        if (source && !scanning) updateGraph();
      } catch (error) {
        inferenceFailed = true;
        pause();
        showError(error);
      }

      raf = requestAnimationFrame(tick);
    }

    window.addEventListener("beforeunload", event => {
      if (!dirty && !locked()) return;
      event.preventDefault();
      event.returnValue = "";
    }, { signal });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      finishDrag();
      pause();
      if (scanning) cancelScan = true;
    }, { signal });

    CM.analysisCanLeave = () => {
      if (busy || saving || finishing) {
        CM.toast("진행 중인 작업이 끝난 뒤 이동하세요.");
        return false;
      }

      if (scanning) {
        CM.toast("구간 분석을 중단한 뒤 이동하세요.");
        return false;
      }

      finishDrag();

      return !dirty || window.confirm(
        "저장하지 않은 측정값이 있습니다. 저장하지 않고 이동할까요?"
      );
    };

    CM.analysisCleanup = () => {
      active = false;
      cancelScan = true;
      cancelAnimationFrame(raf);
      controller.abort();

      if (typeof unbindChart === "function") unbindChart();

      releaseSource();
      model?.close();
      model = null;

      CM.analysisCanLeave = null;
      CM.analysisCleanup = null;
    };

    chooseExerciseMetric();
    renderPhotos();
    syncUI();
    raf = requestAnimationFrame(tick);
  };
})();