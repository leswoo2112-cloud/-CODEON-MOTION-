/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   exercises.js

   운동 목록 / 부위별 분류 / 장비 필터
   즐겨찾기 / 최근 사용 / 사용자 지정 운동

   pictograms.svg는 뒤에서 제공하는 파일입니다.
   자동 반복 인식은 종목별 검증이 필요한 실험 기능입니다.
   ========================================================= */

"use strict";

window.CM = window.CM || {};

CM.categories = [
  "하체",
  "가슴",
  "등",
  "어깨",
  "팔",
  "복근",
  "코어",
  "플라이오메트릭"
];

CM.equipmentTypes = [
  "맨몸",
  "바벨",
  "덤벨",
  "케틀벨",
  "머신",
  "케이블",
  "밴드",
  "기타"
];

CM.jointNames = {
  knee: "무릎",
  hip: "고관절",
  ankle: "발목",
  elbow: "팔꿈치",
  shoulder: "어깨"
};

/* ---------------------------------------------------------
   운동 데이터

   category : 분류
   icon     : 픽토그램 동작 계열
   metric   : 기본 관찰 관절
   mode     : reps / hold / manual
   entries  : 운동명, 장비, 검색 별칭

   manual은 분석 불가라는 뜻이 아닙니다.
   관절 관찰·수동 측정·구간 지정 방식으로 분석합니다.
   --------------------------------------------------------- */

CM.exerciseGroups = [
  {
    category: "하체",
    icon: "squat",
    metric: "knee",
    mode: "reps",
    entries: [
      ["맨몸 스쿼트", "맨몸", "에어 스쿼트 squat"],
      ["백 스쿼트", "바벨", "back squat"],
      ["프런트 스쿼트", "바벨", "front squat"],
      ["고블릿 스쿼트", "덤벨", "goblet squat"],
      ["케틀벨 고블릿 스쿼트", "케틀벨"],
      ["덤벨 스쿼트", "덤벨"],
      ["스모 스쿼트", "맨몸"],
      ["덤벨 스모 스쿼트", "덤벨"],
      ["박스 스쿼트", "바벨"],
      ["스미스 스쿼트", "머신"],
      ["핵 스쿼트", "머신"],
      ["레그프레스", "머신", "leg press"],
      ["싱글레그 스쿼트", "맨몸"],
      ["피스톨 스쿼트", "맨몸"],
      ["오버헤드 스쿼트", "바벨"]
    ]
  },

  {
    category: "하체",
    icon: "lunge",
    metric: "knee",
    mode: "reps",
    entries: [
      ["포워드 런지", "맨몸"],
      ["리버스 런지", "맨몸"],
      ["워킹 런지", "맨몸"],
      ["사이드 런지", "맨몸"],
      ["스플릿 스쿼트", "맨몸"],
      ["불가리안 스플릿 스쿼트", "덤벨"],
      ["스텝업", "기타"],
      ["스텝다운", "기타"],
      ["덤벨 런지", "덤벨"],
      ["바벨 런지", "바벨"],
      ["덤벨 리버스 런지", "덤벨"]
    ]
  },

  {
    category: "하체",
    icon: "hinge",
    metric: "hip",
    mode: "reps",
    entries: [
      ["컨벤셔널 데드리프트", "바벨", "deadlift"],
      ["스모 데드리프트", "바벨"],
      ["루마니안 데드리프트", "바벨", "RDL"],
      ["덤벨 데드리프트", "덤벨"],
      ["덤벨 루마니안 데드리프트", "덤벨"],
      ["싱글레그 데드리프트", "덤벨"],
      ["굿모닝", "바벨"],
      ["케틀벨 데드리프트", "케틀벨"],
      ["트랩바 데드리프트", "바벨"],
      ["케이블 풀스루", "케이블"]
    ]
  },

  {
    category: "하체",
    icon: "bridge",
    metric: "hip",
    mode: "reps",
    entries: [
      ["맨몸 힙쓰러스트", "맨몸"],
      ["바벨 힙쓰러스트", "바벨", "hip thrust"],
      ["덤벨 힙쓰러스트", "덤벨"],
      ["글루트 브리지", "맨몸"],
      ["싱글레그 브리지", "맨몸"],
      ["바벨 글루트 브리지", "바벨"]
    ]
  },

  {
    category: "하체",
    icon: "leg",
    metric: "knee",
    mode: "reps",
    entries: [
      ["레그 익스텐션", "머신"],
      ["시티드 레그컬", "머신"],
      ["라잉 레그컬", "머신"],
      ["스탠딩 레그컬", "머신"],
      ["노르딕 컬", "기타"],
      ["슬라이딩 레그컬", "기타"]
    ]
  },

  {
    category: "하체",
    icon: "calf",
    metric: "ankle",
    mode: "manual",
    entries: [
      ["스탠딩 카프레이즈", "맨몸"],
      ["시티드 카프레이즈", "머신"],
      ["싱글레그 카프레이즈", "맨몸"],
      ["덤벨 카프레이즈", "덤벨"],
      ["레그프레스 카프레이즈", "머신"],
      ["티비얼리스 레이즈", "맨몸"]
    ]
  },

  {
    category: "하체",
    icon: "side",
    metric: "hip",
    mode: "manual",
    entries: [
      ["힙 어브덕션", "머신"],
      ["힙 어덕션", "머신"],
      ["케이블 킥백", "케이블"],
      ["밴드 사이드워크", "밴드"],
      ["클램셸", "맨몸"]
    ]
  },

  {
    category: "하체",
    icon: "squat",
    metric: "knee",
    mode: "hold",
    entries: [
      ["월싯", "맨몸", "wall sit"]
    ]
  },

  {
    category: "가슴",
    icon: "bench",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["바벨 벤치프레스", "바벨", "bench press"],
      ["덤벨 벤치프레스", "덤벨"],
      ["인클라인 바벨 프레스", "바벨"],
      ["인클라인 덤벨 프레스", "덤벨"],
      ["디클라인 바벨 프레스", "바벨"],
      ["디클라인 덤벨 프레스", "덤벨"],
      ["체스트프레스 머신", "머신"],
      ["덤벨 플로어프레스", "덤벨"],
      ["스미스 벤치프레스", "머신"]
    ]
  },

  {
    category: "가슴",
    icon: "pushup",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["푸시업", "맨몸", "push up pushup 팔굽혀펴기"],
      ["무릎 푸시업", "맨몸"],
      ["인클라인 푸시업", "맨몸"],
      ["디클라인 푸시업", "맨몸"],
      ["와이드 푸시업", "맨몸"],
      ["템포 푸시업", "맨몸"]
    ]
  },

  {
    category: "가슴",
    icon: "fly",
    metric: "shoulder",
    mode: "manual",
    entries: [
      ["덤벨 플라이", "덤벨"],
      ["인클라인 덤벨 플라이", "덤벨"],
      ["케이블 플라이", "케이블"],
      ["케이블 크로스오버", "케이블"],
      ["펙덱 플라이", "머신"]
    ]
  },

  {
    category: "가슴",
    icon: "dip",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["딥스", "기타", "dips"],
      ["어시스트 딥스", "머신"]
    ]
  },

  {
    category: "등",
    icon: "pull",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["풀업", "기타", "pull up pullup 턱걸이"],
      ["친업", "기타", "chin up"],
      ["어시스트 풀업", "머신"],
      ["뉴트럴그립 풀업", "기타"],
      ["랫풀다운", "케이블", "lat pulldown"],
      ["클로즈그립 랫풀다운", "케이블"],
      ["원암 랫풀다운", "케이블"]
    ]
  },

  {
    category: "등",
    icon: "row",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["바벨 로우", "바벨", "barbell row"],
      ["원암 덤벨 로우", "덤벨"],
      ["시티드 케이블 로우", "케이블"],
      ["체스트 서포티드 로우", "덤벨"],
      ["T바 로우", "머신"],
      ["인버티드 로우", "기타"],
      ["머신 로우", "머신"],
      ["펜들레이 로우", "바벨"],
      ["밴드 로우", "밴드"],
      ["원암 케이블 로우", "케이블"]
    ]
  },

  {
    category: "등",
    icon: "fly",
    metric: "shoulder",
    mode: "manual",
    entries: [
      ["스트레이트암 풀다운", "케이블"],
      ["덤벨 풀오버", "덤벨"]
    ]
  },

  {
    category: "어깨",
    icon: "press",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["바벨 오버헤드프레스", "바벨", "OHP 밀리터리 프레스"],
      ["덤벨 숄더프레스", "덤벨"],
      ["아놀드프레스", "덤벨"],
      ["머신 숄더프레스", "머신"],
      ["랜드마인 프레스", "바벨"],
      ["시티드 바벨 프레스", "바벨"],
      ["원암 덤벨 숄더프레스", "덤벨"]
    ]
  },

  {
    category: "어깨",
    icon: "raise",
    metric: "shoulder",
    mode: "manual",
    entries: [
      ["사이드 레터럴레이즈", "덤벨", "사레레"],
      ["프런트레이즈", "덤벨"],
      ["케이블 레터럴레이즈", "케이블"],
      ["리어델트 플라이", "덤벨"],
      ["리버스 펙덱", "머신"],
      ["페이스풀", "케이블"],
      ["밴드 풀어파트", "밴드"]
    ]
  },

  {
    category: "어깨",
    icon: "shrug",
    metric: "shoulder",
    mode: "manual",
    entries: [
      ["바벨 슈러그", "바벨"],
      ["덤벨 슈러그", "덤벨"]
    ]
  },

  {
    category: "팔",
    icon: "curl",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["바벨 컬", "바벨"],
      ["EZ바 컬", "바벨"],
      ["덤벨 컬", "덤벨"],
      ["얼터네이팅 컬", "덤벨"],
      ["해머 컬", "덤벨"],
      ["인클라인 덤벨 컬", "덤벨"],
      ["프리처 컬", "바벨"],
      ["컨센트레이션 컬", "덤벨"],
      ["케이블 컬", "케이블"],
      ["리버스 컬", "바벨"],
      ["스파이더 컬", "덤벨"]
    ]
  },

  {
    category: "팔",
    icon: "extension",
    metric: "elbow",
    mode: "reps",
    entries: [
      ["케이블 푸시다운", "케이블"],
      ["로프 푸시다운", "케이블"],
      ["오버헤드 트라이셉스 익스텐션", "덤벨"],
      ["라잉 트라이셉스 익스텐션", "바벨"],
      ["덤벨 킥백", "덤벨"],
      ["원암 케이블 푸시다운", "케이블"],
      ["클로즈그립 벤치프레스", "바벨"],
      ["다이아몬드 푸시업", "맨몸"]
    ]
  },

  {
    category: "팔",
    icon: "wrist",
    metric: "elbow",
    mode: "manual",
    entries: [
      ["리스트 컬", "덤벨"],
      ["리버스 리스트 컬", "덤벨"],
      ["전완 회내·회외", "덤벨"]
    ]
  },

  {
    category: "복근",
    icon: "crunch",
    metric: "hip",
    mode: "manual",
    entries: [
      ["크런치", "맨몸"],
      ["리버스 크런치", "맨몸"],
      ["싯업", "맨몸", "sit up"],
      ["레그레이즈", "맨몸"],
      ["행잉 니레이즈", "기타"],
      ["바이시클 크런치", "맨몸"],
      ["러시안 트위스트", "맨몸"],
      ["케이블 크런치", "케이블"],
      ["V업", "맨몸"],
      ["힐터치", "맨몸"]
    ]
  },

  {
    category: "코어",
    icon: "plank",
    metric: "hip",
    mode: "hold",
    entries: [
      ["플랭크", "맨몸", "plank"],
      ["사이드 플랭크", "맨몸"],
      ["하이 플랭크", "맨몸"],
      ["리버스 플랭크", "맨몸"],
      ["할로우 홀드", "맨몸"]
    ]
  },

  {
    category: "코어",
    icon: "bird",
    metric: "hip",
    mode: "manual",
    entries: [
      ["데드버그", "맨몸"],
      ["버드독", "맨몸"],
      ["팔로프 프레스", "케이블"],
      ["앱휠 롤아웃", "기타"],
      ["마운틴클라이머", "맨몸"],
      ["숄더탭", "맨몸"],
      ["파머스 캐리", "덤벨"],
      ["수트케이스 캐리", "덤벨"]
    ]
  },

  {
    category: "플라이오메트릭",
    icon: "jump",
    metric: "knee",
    mode: "manual",
    entries: [
      ["스쿼트 점프", "맨몸"],
      ["박스 점프", "기타"],
      ["브로드 점프", "맨몸"],
      ["스케이터 점프", "맨몸"],
      ["포고 점프", "맨몸"],
      ["턱 점프", "맨몸"],
      ["스플릿 점프", "맨몸"],
      ["싱글레그 홉", "맨몸"],
      ["허들 점프", "기타"],
      ["드롭 점프", "기타"],
      ["플라이오 푸시업", "맨몸"],
      ["버피", "맨몸"]
    ]
  }
];

/* ---------------------------------------------------------
   기본 운동 목록 생성
   --------------------------------------------------------- */

CM.builtInExercises = CM.exerciseGroups.flatMap(group => {
  return group.entries.map(entry => {
    const [name, equipment, aliases = ""] = entry;

    return {
      id: "ex-" + name,
      name,
      category: group.category,
      equipment,
      aliases,
      icon: group.icon,
      metric: group.metric,
      mode: group.mode,
      custom: false
    };
  });
});

CM.exercises = [...CM.builtInExercises];

/* ---------------------------------------------------------
   사용자 지정 운동 불러오기
   --------------------------------------------------------- */

CM.loadExercises = async function () {
  const saved = await CM.db.get(
    "settings",
    "custom-ex"
  );

  const allowedIcons = new Set(
    CM.builtInExercises.map(exercise => exercise.icon)
  );

  const usedIds = new Set(
    CM.builtInExercises.map(exercise => exercise.id)
  );

  const custom = [];

  for (const item of saved?.items || []) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      usedIds.has(item.id)
    ) {
      continue;
    }

    usedIds.add(item.id);

    custom.push({
      id: item.id,
      name: item.name.trim().slice(0, 60),

      category: CM.categories.includes(item.category)
        ? item.category
        : "코어",

      equipment: CM.equipmentTypes.includes(item.equipment)
        ? item.equipment
        : "기타",

      aliases: String(item.aliases || "").slice(0, 120),

      icon: allowedIcons.has(item.icon)
        ? item.icon
        : "squat",

      metric: Object.hasOwn(CM.jointNames, item.metric)
        ? item.metric
        : "knee",

      mode: ["reps", "hold", "manual"].includes(item.mode)
        ? item.mode
        : "manual",

      custom: true
    });
  }

  CM.exercises = [
    ...CM.builtInExercises,
    ...custom
  ];

  return CM.exercises;
};

CM.exerciseById = function (id) {
  return (
    CM.exercises.find(exercise => exercise.id === id) ||
    CM.exercises[0]
  );
};

/* ---------------------------------------------------------
   픽토그램 / 분석 방식 이름
   --------------------------------------------------------- */

CM.icon = function (exercise) {
  const title = CM.escape(
    exercise.name + " 동작 계열 픽토그램"
  );

  const icon = CM.escape(exercise.icon);

  return `
    <svg
      class="picto"
      viewBox="0 0 120 100"
      role="img"
      aria-label="${title}"
    >
      <use href="pictograms.svg#${icon}"></use>
    </svg>
  `;
};

CM.analysisModeLabel = function (mode) {
  const labels = {
    reps: "반복 분석 · 실험",
    hold: "유지 시간 분석",
    manual: "수동 구간 분석"
  };

  return labels[mode] || labels.manual;
};

CM.exerciseSearchKey = function (text) {
  return String(text || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[\s·_-]/g, "");
};

/* ---------------------------------------------------------
   최근 사용 기록
   --------------------------------------------------------- */

CM.rememberExercise = async function (exerciseId) {
  const saved =
    await CM.db.get("settings", "recent-exercises") || {
      id: "recent-exercises",
      items: []
    };

  const items = Array.isArray(saved.items)
    ? saved.items
    : [];

  saved.items = [
    exerciseId,
    ...items.filter(id => id !== exerciseId)
  ].slice(0, 20);

  await CM.db.put("settings", saved);
};

/* ---------------------------------------------------------
   운동 설명 창
   --------------------------------------------------------- */

CM.showExerciseInfo = function (exercise) {
  const name = CM.escape(exercise.name);
  const category = CM.escape(exercise.category);
  const equipment = CM.escape(exercise.equipment);
  const metric = CM.jointNames[exercise.metric];

  let detail = "";

  if (exercise.mode === "reps") {
    detail = `
      반복 인식은 선택한 관절 각도의 변화를 이용하는
      설정형 실험 기능입니다.
      촬영 영상을 확인하고 반복 구간을 수정할 수 있습니다.
    `;
  } else if (exercise.mode === "hold") {
    detail = `
      사용자가 지정한 유지 구간의 시간과
      관절 각도·위치 변화를 기록합니다.
    `;
  } else {
    detail = `
      관절 움직임을 관찰하고 시작·종료 구간을 직접 지정합니다.
      자동 반복 횟수를 임의로 생성하지 않습니다.
    `;
  }

  const wristNote =
    exercise.icon === "wrist"
      ? `
        <p class="warn">
          기본 신체 스켈레톤만으로 손목 회전이나
          전완 회내·회외를 정밀 측정하지 않습니다.
          영상 관찰과 수동 표시를 사용합니다.
        </p>
      `
      : "";

  CM.modal(`
    <h2>${name}</h2>

    ${CM.icon(exercise)}

    <p>${category} · ${equipment}</p>

    <p>
      기본 관찰 항목:
      <strong>${metric}</strong>
    </p>

    <p class="notice">${detail}</p>

    <p class="notice">
      스켈레톤·좌우 선택·그래프·수동 보정·리포트를
      사용할 수 있습니다.
      실제 측정 가능 항목은 촬영 방향과 가림에 따라 달라집니다.
    </p>

    ${wristNote}
  `);
};

/* ---------------------------------------------------------
   사용자 지정 운동 등록
   --------------------------------------------------------- */

CM.openCustomExerciseForm = function (onSaved) {
  const categoryOptions = CM.categories
    .map(value => `<option>${value}</option>`)
    .join("");

  const equipmentOptions = CM.equipmentTypes
    .map(value => `<option>${value}</option>`)
    .join("");

  const jointOptions = Object.entries(CM.jointNames)
    .map(([key, label]) => {
      return `<option value="${key}">${label}</option>`;
    })
    .join("");

  const iconOptions = [
    ["squat", "스쿼트"],
    ["lunge", "런지"],
    ["hinge", "힙힌지"],
    ["bridge", "브리지"],
    ["leg", "무릎 굽힘·폄"],
    ["calf", "종아리"],
    ["side", "다리 옆 움직임"],
    ["bench", "벤치프레스"],
    ["pushup", "푸시업"],
    ["fly", "플라이"],
    ["dip", "딥스"],
    ["pull", "풀업"],
    ["row", "로우"],
    ["press", "숄더프레스"],
    ["raise", "레이즈"],
    ["shrug", "슈러그"],
    ["curl", "컬"],
    ["extension", "삼두 익스텐션"],
    ["wrist", "전완"],
    ["crunch", "복근"],
    ["plank", "플랭크"],
    ["bird", "코어"],
    ["jump", "점프"]
  ].map(([value, label]) => {
    return `<option value="${value}">${label}</option>`;
  }).join("");

  CM.modal(
    `
      <h2>사용자 지정 운동</h2>

      <form id="custom-ex-form" class="stack">
        <label>
          운동 이름
          <input
            name="name"
            required
            maxlength="60"
            autocomplete="off"
          >
        </label>

        <div class="form-grid">
          <label>
            분류
            <select name="category">
              ${categoryOptions}
            </select>
          </label>

          <label>
            장비
            <select name="equipment">
              ${equipmentOptions}
            </select>
          </label>

          <label>
            기본 관찰 관절
            <select name="metric">
              ${jointOptions}
            </select>
          </label>

          <label>
            분석 방식
            <select name="mode">
              <option value="manual">수동 구간 분석</option>
              <option value="hold">유지 시간 분석</option>
              <option value="reps">반복 분석 · 실험</option>
            </select>
          </label>

          <label>
            픽토그램 계열
            <select name="icon">
              ${iconOptions}
            </select>
          </label>

          <label>
            검색 별칭
            <input
              name="aliases"
              maxlength="120"
              placeholder="영문 이름 또는 다른 이름"
            >
          </label>
        </div>

        <p class="notice">
          운동 등록만으로 분석 정확도가 검증되는 것은 아닙니다.
          촬영 영상을 확인하면서 측정 항목과 구간을 설정하세요.
        </p>

        <button type="submit" class="primary">
          운동 등록
        </button>
      </form>
    `,

    function () {
      const form = document.querySelector(
        "#custom-ex-form"
      );

      form.onsubmit = async function (event) {
        event.preventDefault();

        const submit = form.querySelector(
          'button[type="submit"]'
        );

        const values = new FormData(form);
        const name = String(values.get("name")).trim();

        if (!name) {
          CM.toast("운동 이름을 입력해 주세요.");
          return;
        }

        const duplicate = CM.exercises.some(exercise => {
          return (
            CM.exerciseSearchKey(exercise.name) ===
            CM.exerciseSearchKey(name)
          );
        });

        if (duplicate) {
          CM.toast("같은 이름의 운동이 이미 있습니다.");
          return;
        }

        submit.disabled = true;

        try {
          const exercise = {
            id: "custom-" + CM.uid(),
            name,
            category: values.get("category"),
            equipment: values.get("equipment"),
            metric: values.get("metric"),
            mode: values.get("mode"),
            icon: values.get("icon"),
            aliases: String(values.get("aliases") || "").trim(),
            custom: true
          };

          const saved =
            await CM.db.get("settings", "custom-ex") || {
              id: "custom-ex",
              items: []
            };

          saved.items = Array.isArray(saved.items)
            ? saved.items
            : [];

          saved.items.push(exercise);

          await CM.db.put("settings", saved);
          await CM.loadExercises();

          document.querySelector("#modal").close();

          CM.toast("운동을 등록했습니다.");

          if (typeof onSaved === "function") {
            await onSaved();
          }
        } catch (error) {
          CM.toast(error.message || "운동 등록에 실패했습니다.");
        } finally {
          submit.disabled = false;
        }
      };
    }
  );
};

/* ---------------------------------------------------------
   운동 목록 화면
   --------------------------------------------------------- */

CM.renderExercises = async function () {
  await CM.loadExercises();

  const main = document.querySelector("#main");

  const favorites =
    await CM.db.get("settings", "favorites") || {
      id: "favorites",
      items: []
    };

  const recent =
    await CM.db.get("settings", "recent-exercises") || {
      id: "recent-exercises",
      items: []
    };

  favorites.items = Array.isArray(favorites.items)
    ? favorites.items
    : [];

  recent.items = Array.isArray(recent.items)
    ? recent.items
    : [];

  let selectedCategory = "전체";
  let onlyFavorites = false;
  let onlyRecent = false;

  main.innerHTML =
    CM.heading(
      "운동 라이브러리",
      "EXERCISE LIBRARY",
      `<span class="badge">${CM.exercises.length}개 운동</span>`
    ) +
    `
      <section class="panel">
        <div class="row">
          <input
            id="ex-search"
            type="search"
            aria-label="운동 검색"
            placeholder="운동 이름·영문·별칭 검색"
            style="flex:1;min-width:170px"
          >

          <select
            id="ex-equipment"
            aria-label="장비 필터"
            style="width:160px"
          >
            <option value="all">모든 장비</option>

            ${CM.equipmentTypes.map(value => {
              return `<option>${value}</option>`;
            }).join("")}
          </select>

          <button
            id="ex-favorites"
            type="button"
            aria-pressed="false"
          >
            ☆ 즐겨찾기
          </button>

          <button
            id="ex-recent"
            type="button"
            aria-pressed="false"
          >
            최근 사용
          </button>

          <button
            id="ex-add"
            type="button"
          >
            + 운동 추가
          </button>
        </div>

        <div
          id="ex-categories"
          class="tabs"
          aria-label="운동 부위 필터"
        >
          ${["전체", ...CM.categories].map((value, index) => {
            return `
              <button
                type="button"
                data-category="${value}"
                class="${index === 0 ? "active-filter" : ""}"
                aria-pressed="${index === 0}"
              >
                ${value}
              </button>
            `;
          }).join("")}
        </div>

        <p class="notice">
          모든 운동에서 영상 관찰·관절 측정·수동 보정·리포트를
          사용할 수 있습니다.
          자동 반복 인식은 검증이 필요한 실험 기능입니다.
        </p>

        <p class="notice">
          픽토그램은 운동의 동작 계열을 표시합니다.
        </p>
      </section>

      <div class="row spread" style="margin-bottom:14px">
        <span id="ex-result-count" class="muted"></span>
      </div>

      <div
        id="ex-cards"
        class="grid g4"
      ></div>
    `;

  const search = document.querySelector("#ex-search");
  const equipment = document.querySelector("#ex-equipment");
  const cards = document.querySelector("#ex-cards");

  function draw() {
    const query = CM.exerciseSearchKey(search.value);
    const selectedEquipment = equipment.value;

    let results = CM.exercises.filter(exercise => {
      const searchText = CM.exerciseSearchKey(
        exercise.name + " " + exercise.aliases
      );

      return (
        (
          selectedCategory === "전체" ||
          exercise.category === selectedCategory
        ) &&
        (
          selectedEquipment === "all" ||
          exercise.equipment === selectedEquipment
        ) &&
        (
          !query ||
          searchText.includes(query)
        ) &&
        (
          !onlyFavorites ||
          favorites.items.includes(exercise.id)
        ) &&
        (
          !onlyRecent ||
          recent.items.includes(exercise.id)
        )
      );
    });

    if (onlyRecent) {
      results = results.sort((a, b) => {
        return (
          recent.items.indexOf(a.id) -
          recent.items.indexOf(b.id)
        );
      });
    }

    document.querySelector("#ex-result-count").textContent =
      results.length + "개 운동";

    if (!results.length) {
      cards.innerHTML = `
        <div class="panel" style="grid-column:1/-1">
          ${CM.empty("조건에 맞는 운동이 없습니다.")}
        </div>
      `;
      return;
    }

    cards.innerHTML = results.map(exercise => {
      const favorite = favorites.items.includes(exercise.id);
      const id = CM.escape(exercise.id);

      return `
        <article class="exercise-card">
          ${CM.icon(exercise)}

          <small>
            ${CM.escape(exercise.category)}
            ·
            ${CM.escape(exercise.equipment)}
          </small>

          <h3>${CM.escape(exercise.name)}</h3>

          <span class="notice">
            ${CM.analysisModeLabel(exercise.mode)}
          </span>

          <div class="row spread card-foot">
            <button
              class="small"
              type="button"
              data-action="favorite"
              data-id="${id}"
              aria-label="즐겨찾기"
              aria-pressed="${favorite}"
            >
              ${favorite ? "★" : "☆"}
            </button>

            <button
              class="small"
              type="button"
              data-action="info"
              data-id="${id}"
            >
              설명
            </button>

            <button
              class="small"
              type="button"
              data-action="start"
              data-id="${id}"
            >
              자세분석 →
            </button>
          </div>
        </article>
      `;
    }).join("");
  }

  search.oninput = draw;
  equipment.onchange = draw;

  document.querySelector("#ex-categories").onclick =
    function (event) {
      const button = event.target.closest(
        "button[data-category]"
      );

      if (!button) return;

      selectedCategory = button.dataset.category;

      document.querySelectorAll(
        "#ex-categories button"
      ).forEach(item => {
        const selected = item === button;

        item.classList.toggle(
          "active-filter",
          selected
        );

        item.setAttribute(
          "aria-pressed",
          String(selected)
        );
      });

      draw();
    };

  document.querySelector("#ex-favorites").onclick =
    function (event) {
      onlyFavorites = !onlyFavorites;

      event.currentTarget.classList.toggle(
        "active-filter",
        onlyFavorites
      );

      event.currentTarget.setAttribute(
        "aria-pressed",
        String(onlyFavorites)
      );

      draw();
    };

  document.querySelector("#ex-recent").onclick =
    function (event) {
      onlyRecent = !onlyRecent;

      event.currentTarget.classList.toggle(
        "active-filter",
        onlyRecent
      );

      event.currentTarget.setAttribute(
        "aria-pressed",
        String(onlyRecent)
      );

      draw();
    };

  document.querySelector("#ex-add").onclick = function () {
    CM.openCustomExerciseForm(CM.renderExercises);
  };

  cards.onclick = async function (event) {
    const button = event.target.closest(
      "button[data-action]"
    );

    if (!button) return;

    const exercise = CM.exercises.find(item => {
      return item.id === button.dataset.id;
    });

    if (!exercise) return;

    const action = button.dataset.action;

    if (action === "info") {
      CM.showExerciseInfo(exercise);
      return;
    }

    button.disabled = true;

    try {
      if (action === "favorite") {
        const previous = [...favorites.items];

        favorites.items = favorites.items.includes(exercise.id)
          ? favorites.items.filter(id => id !== exercise.id)
          : [...favorites.items, exercise.id];

        try {
          await CM.db.put("settings", favorites);
        } catch (error) {
          favorites.items = previous;
          throw error;
        }

        draw();
      }

      if (action === "start") {
        await CM.rememberExercise(exercise.id);

        CM.selectedExercise = exercise.id;

        location.hash = "analysis";
      }
    } catch (error) {
      CM.toast(
        error.message || "요청을 처리하지 못했습니다."
      );
    } finally {
      button.disabled = false;
    }
  };

  draw();
};