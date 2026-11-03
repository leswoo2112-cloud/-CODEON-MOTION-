/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   charts.js

   외부 그래프 라이브러리 없이 SVG로 표시합니다.

   - 관절 각도 변화
   - 좌우 비교
   - 반복별 막대그래프
   - 육각형 그래프
   - 관절·바벨 궤적
   - 히트맵
   - 동작 단계 타임라인
   - 그래프 시점 선택
   - SVG 다운로드
   ========================================================= */

"use strict";

window.CM = window.CM || {};

CM.colors = [
  "#50daf2",
  "#e691c0",
  "#e5c87b",
  "#80dcb8",
  "#a69bed",
  "#ffae7d"
];

/* ---------------------------------------------------------
   공통 계산
   null / undefined / NaN은 0으로 바꾸지 않습니다.
   --------------------------------------------------------- */

CM.fmt = function (value, digits = 1) {
  return Number.isFinite(value)
    ? value.toFixed(digits)
    : "—";
};

CM.clamp = function (value, min, max) {
  return Math.min(max, Math.max(min, value));
};

CM.stats = function (values = []) {
  const numbers = values.filter(Number.isFinite);

  if (!numbers.length) {
    return {
      min: null,
      max: null,
      mean: null,
      median: null,
      range: null,
      sd: null,
      n: 0
    };
  }

  let min = Infinity;
  let max = -Infinity;
  let mean = 0;
  let sumSquaredDifferences = 0;

  numbers.forEach((value, index) => {
    min = Math.min(min, value);
    max = Math.max(max, value);

    const delta = value - mean;

    mean += delta / (index + 1);

    sumSquaredDifferences +=
      delta * (value - mean);
  });

  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    min,
    max,
    mean,
    median,
    range: max - min,
    sd: Math.sqrt(
      Math.max(0, sumSquaredDifferences / numbers.length)
    ),
    n: numbers.length
  };
};

CM.chartEscape = function (value) {
  return CM.escape(value);
};

CM.chartColor = function (value, index = 0) {
  if (
    typeof value === "string" &&
    /^#[0-9a-f]{3,8}$/i.test(value)
  ) {
    return value;
  }

  return CM.colors[index % CM.colors.length];
};

CM.chartEmpty = function (
  message = "측정 데이터가 없습니다."
) {
  return `
    <div class="empty">
      ${CM.chartEscape(message)}
    </div>
  `;
};

CM.chartLegend = function (series) {
  return `
    <div class="chart-legend">
      ${series.map((item, index) => {
        const color = CM.chartColor(item.color, index);

        return `
          <span>
            <i
              class="dot"
              style="background:${color}"
            ></i>
            ${CM.chartEscape(item.name)}
            ${item.dash ? " · 점선" : ""}
          </span>
        `;
      }).join("")}
    </div>
  `;
};

/* ---------------------------------------------------------
   선그래프

   series:
   [
     {
       name: "왼쪽 무릎",
       color: "#50daf2",
       dash: false,
       data: [
         { x: 0, y: 170 },
         { x: 0.1, y: null },
         { x: 0.2, y: 160 }
       ]
     }
   ]

   maxGap보다 긴 시간 간격은 연결하지 않습니다.
   --------------------------------------------------------- */

CM.lineChart = function (series = [], options = {}) {
  const width = 760;
  const height = options.height || 240;

  const padding = {
    left: 58,
    right: 20,
    top: 22,
    bottom: 35
  };

  const unit = options.unit ?? "°";
  const xUnit = options.xUnit ?? "s";
  const maxGap = options.maxGap ?? 0.8;

  const cleaned = series.map(item => ({
    ...item,
    data: (item.data || [])
      .filter(point => Number.isFinite(point.x))
      .slice()
      .sort((a, b) => a.x - b.x)
  }));

  const all = cleaned.flatMap(item => item.data);

  if (!all.length) {
    return CM.chartEmpty();
  }

  const xStats = CM.stats(all.map(point => point.x));
  const yStats = CM.stats(all.map(point => point.y));

  if (!yStats.n) {
    return CM.chartEmpty("선택한 항목의 유효한 측정값이 없습니다.");
  }

  let xMin = Number.isFinite(options.xMin)
    ? options.xMin
    : xStats.min;

  let xMax = Number.isFinite(options.xMax)
    ? options.xMax
    : xStats.max;

  let yMin = Number.isFinite(options.min)
    ? options.min
    : Math.min(0, yStats.min);

  let yMax = Number.isFinite(options.max)
    ? options.max
    : Math.max(yMin + 1, yStats.max);

  if (xMax <= xMin) {
    xMax = xMin + 1;
  }

  if (yMax <= yMin) {
    yMax = yMin + 1;
  }

  const plotWidth =
    width - padding.left - padding.right;

  const plotHeight =
    height - padding.top - padding.bottom;

  const X = value => {
    return (
      padding.left +
      ((value - xMin) / (xMax - xMin)) * plotWidth
    );
  };

  const Y = value => {
    return (
      height -
      padding.bottom -
      ((value - yMin) / (yMax - yMin)) * plotHeight
    );
  };

  const clipId = "clip-" + CM.uid();

  let svg = `
    <svg
      class="chart"
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="${CM.chartEscape(
        options.title || "시간별 측정값 변화"
      )}"
      data-xmin="${xMin}"
      data-xmax="${xMax}"
      data-plot-left="${padding.left}"
      data-plot-right="${width - padding.right}"
    >
      <defs>
        <clipPath id="${clipId}">
          <rect
            x="${padding.left}"
            y="${padding.top}"
            width="${plotWidth}"
            height="${plotHeight}"
          />
        </clipPath>
      </defs>
  `;

  for (let index = 0; index <= 4; index += 1) {
    const y = yMin + ((yMax - yMin) * index) / 4;
    const x = xMin + ((xMax - xMin) * index) / 4;

    svg += `
      <line
        class="gridline"
        x1="${padding.left}"
        x2="${width - padding.right}"
        y1="${Y(y)}"
        y2="${Y(y)}"
      />

      <text
        x="${padding.left - 8}"
        y="${Y(y) + 4}"
        text-anchor="end"
      >
        ${CM.fmt(y, 0)}${CM.chartEscape(unit)}
      </text>

      <text
        x="${X(x)}"
        y="${height - 9}"
        text-anchor="middle"
      >
        ${CM.fmt(x)}${CM.chartEscape(xUnit)}
      </text>
    `;
  }

  svg += `<g clip-path="url(#${clipId})">`;

  if (
    options.target &&
    Number.isFinite(options.target.min) &&
    Number.isFinite(options.target.max) &&
    options.target.max >= options.target.min
  ) {
    const top = Y(options.target.max);
    const bottom = Y(options.target.min);

    svg += `
      <rect
        x="${padding.left}"
        y="${top}"
        width="${plotWidth}"
        height="${bottom - top}"
        fill="#80dcb8"
        fill-opacity="0.12"
      />
    `;
  }

  cleaned.forEach((item, seriesIndex) => {
    let path = "";
    let connected = false;
    let previousX = null;

    const color = CM.chartColor(
      item.color,
      seriesIndex
    );

    for (const point of item.data) {
      if (!Number.isFinite(point.y)) {
        connected = false;
        previousX = null;
        continue;
      }

      if (
        previousX !== null &&
        point.x - previousX > maxGap
      ) {
        connected = false;
      }

      path +=
        (connected ? "L" : "M") +
        X(point.x).toFixed(2) +
        "," +
        Y(point.y).toFixed(2) +
        " ";

      connected = true;
      previousX = point.x;
    }

    svg += `
      <path
        d="${path}"
        fill="none"
        stroke="${color}"
        stroke-width="2.2"
        ${item.dash ? 'stroke-dasharray="6 4"' : ""}
      />
    `;

    const points = item.data.filter(point => {
      return (
        Number.isFinite(point.y) &&
        point.x >= xMin &&
        point.x <= xMax
      );
    });

    if (points.length <= 120) {
      svg += points.map(point => `
        <circle
          cx="${X(point.x)}"
          cy="${Y(point.y)}"
          r="2.3"
          fill="${color}"
        >
          <title>${CM.chartEscape(item.name)}:
${CM.fmt(point.x)}${CM.chartEscape(xUnit)}
${CM.fmt(point.y)}${CM.chartEscape(unit)}</title>
        </circle>
      `).join("");
    }
  });

  if (
    Number.isFinite(options.currentTime) &&
    options.currentTime >= xMin &&
    options.currentTime <= xMax
  ) {
    svg += `
      <line
        x1="${X(options.currentTime)}"
        x2="${X(options.currentTime)}"
        y1="${padding.top}"
        y2="${height - padding.bottom}"
        stroke="#ffffff"
        stroke-dasharray="4 4"
        opacity="0.7"
      />
    `;
  }

  svg += "</g></svg>";

  return svg + CM.chartLegend(cleaned);
};

/* ---------------------------------------------------------
   막대그래프
   음수와 측정 불가 항목도 구분합니다.

   items: [{ label: "1회", value: 120 }]
   --------------------------------------------------------- */

CM.barChart = function (items = [], unit = "") {
  if (!items.length) {
    return CM.chartEmpty("비교할 항목이 없습니다.");
  }

  const values = CM.stats(
    items.map(item => item.value)
  );

  if (!values.n) {
    return CM.chartEmpty("유효한 비교 수치가 없습니다.");
  }

  const width = Math.max(760, items.length * 65);
  const height = 250;

  const left = 55;
  const right = 20;
  const top = 28;
  const bottom = 55;

  const min = Math.min(0, values.min);
  const max = Math.max(0, values.max, min + 1);

  const Y = value => {
    return (
      height -
      bottom -
      ((value - min) / (max - min)) *
        (height - top - bottom)
    );
  };

  const baseline = Y(0);
  const step = (width - left - right) / items.length;
  const barWidth = Math.max(5, step * 0.58);

  let svg = `
    <svg
      class="chart"
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="항목별 측정값 비교"
    >
      <line
        class="gridline"
        x1="${left}"
        x2="${width - right}"
        y1="${baseline}"
        y2="${baseline}"
      />
  `;

  items.forEach((item, index) => {
    const valid = Number.isFinite(item.value);
    const x = left + step * index + step / 2;
    const color = CM.chartColor(item.color, index);

    if (valid) {
      const y = Y(item.value);
      const barTop = Math.min(y, baseline);
      const barHeight = Math.abs(y - baseline);

      svg += `
        <rect
          x="${x - barWidth / 2}"
          y="${barTop}"
          width="${barWidth}"
          height="${barHeight}"
          rx="3"
          fill="${color}"
        >
          <title>${CM.chartEscape(item.label)}:
${CM.fmt(item.value)}${CM.chartEscape(unit)}</title>
        </rect>

        <text
          x="${x}"
          y="${item.value < 0 ? y + 16 : y - 8}"
          text-anchor="middle"
        >
          ${CM.fmt(item.value)}${CM.chartEscape(unit)}
        </text>
      `;
    } else {
      svg += `
        <text
          x="${x}"
          y="${baseline - 10}"
          text-anchor="middle"
        >
          측정 불가
        </text>
      `;
    }

    svg += `
      <text
        x="${x}"
        y="${height - 15}"
        text-anchor="middle"
      >
        ${CM.chartEscape(item.label)}
      </text>
    `;
  });

  return svg + "</svg>";
};

/* ---------------------------------------------------------
   육각형 그래프

   axes: 정확히 6개 항목
   [{ name: "반복 일관성", value: 80 }]

   value는 호출하는 분석 코드에서 계산합니다.
   이 파일은 임의의 자세 점수를 만들지 않습니다.

   하나라도 측정 불가이면 다각형을 닫지 않습니다.
   --------------------------------------------------------- */

CM.radar = function (axes = [], previous = null) {
  if (axes.length !== 6) {
    return CM.chartEmpty("육각형에는 6개 지표가 필요합니다.");
  }

  const centerX = 210;
  const centerY = 175;
  const radius = 110;

  function point(index, value) {
    const angle = (Math.PI * 2 * index) / 6;
    const distance = radius * value / 100;

    return [
      centerX + Math.sin(angle) * distance,
      centerY - Math.cos(angle) * distance
    ];
  }

  function validValue(value) {
    return (
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100
    );
  }

  function complete(data) {
    return (
      Array.isArray(data) &&
      data.length === 6 &&
      data.every(item => validValue(item.value))
    );
  }

  let svg = `
    <svg
      class="chart"
      viewBox="0 0 420 360"
      role="img"
      aria-label="6개 지표 육각형 비교"
    >
  `;

  for (const level of [25, 50, 75, 100]) {
    const points = axes.map((_, index) => {
      return point(index, level).join(",");
    }).join(" ");

    svg += `
      <polygon
        points="${points}"
        fill="none"
        stroke="#355160"
      />
    `;
  }

  axes.forEach((axis, index) => {
    const end = point(index, 100);
    const label = point(index, 132);

    svg += `
      <line
        x1="${centerX}"
        y1="${centerY}"
        x2="${end[0]}"
        y2="${end[1]}"
        stroke="#355160"
      />

      <text
        x="${label[0]}"
        y="${label[1]}"
        text-anchor="middle"
      >
        ${CM.chartEscape(axis.name)}
      </text>

      <text
        x="${label[0]}"
        y="${label[1] + 16}"
        text-anchor="middle"
      >
        ${
          validValue(axis.value)
            ? CM.fmt(axis.value, 0)
            : "측정 불가"
        }
      </text>
    `;
  });

  const comparable =
    complete(previous) &&
    previous.every((item, index) => {
      return item.name === axes[index].name;
    });

  if (comparable) {
    svg += `
      <polygon
        points="${previous.map((axis, index) => {
          return point(index, axis.value).join(",");
        }).join(" ")}"
        fill="#e691c0"
        fill-opacity="0.05"
        stroke="#e691c0"
        stroke-width="2"
        stroke-dasharray="5 4"
      />
    `;
  }

  if (complete(axes)) {
    svg += `
      <polygon
        points="${axes.map((axis, index) => {
          return point(index, axis.value).join(",");
        }).join(" ")}"
        fill="#50daf2"
        fill-opacity="0.18"
        stroke="#50daf2"
        stroke-width="2"
      />
    `;
  } else {
    axes.forEach((axis, index) => {
      if (!validValue(axis.value)) return;

      const position = point(index, axis.value);

      svg += `
        <circle
          cx="${position[0]}"
          cy="${position[1]}"
          r="4"
          fill="#50daf2"
        />
      `;
    });

    svg += `
      <text
        x="${centerX}"
        y="${centerY}"
        text-anchor="middle"
      >
        일부 지표 측정 불가
      </text>
    `;
  }

  svg += "</svg>";

  const legend = [
    { name: "현재 기록", color: CM.colors[0] }
  ];

  if (comparable) {
    legend.push({
      name: "이전 기록",
      color: CM.colors[1],
      dash: true
    });
  }

  return svg + CM.chartLegend(legend);
};

/* ---------------------------------------------------------
   궤적 그래프

   points: [{ x, y }, null, ...]
   영상 픽셀 좌표를 사용하면 위쪽이 작은 y입니다.
   x, y 축의 배율을 동일하게 유지합니다.
   --------------------------------------------------------- */

CM.trajectoryChart = function (points = []) {
  const valid = points.filter(point => {
    return (
      point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y)
    );
  });

  if (!valid.length) {
    return CM.chartEmpty("표시할 궤적이 없습니다.");
  }

  const width = 480;
  const height = 320;
  const padding = 35;

  const xs = CM.stats(valid.map(point => point.x));
  const ys = CM.stats(valid.map(point => point.y));

  const rangeX = Math.max(xs.range, 1);
  const rangeY = Math.max(ys.range, 1);

  const scale = Math.min(
    (width - padding * 2) / rangeX,
    (height - padding * 2) / rangeY
  );

  const middleX = (xs.min + xs.max) / 2;
  const middleY = (ys.min + ys.max) / 2;

  const X = value => {
    return width / 2 + (value - middleX) * scale;
  };

  const Y = value => {
    return height / 2 + (value - middleY) * scale;
  };

  let path = "";
  let connected = false;

  for (const point of points) {
    if (
      !point ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      connected = false;
      continue;
    }

    path +=
      (connected ? "L" : "M") +
      X(point.x).toFixed(2) +
      "," +
      Y(point.y).toFixed(2) +
      " ";

    connected = true;
  }

  const first = valid[0];
  const last = valid[valid.length - 1];

  return `
    <svg
      class="chart"
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="화면 좌표 기준 이동 궤적"
    >
      <path
        d="${path}"
        fill="none"
        stroke="#50daf2"
        stroke-width="2.5"
      />

      <circle
        cx="${X(first.x)}"
        cy="${Y(first.y)}"
        r="5"
        fill="#80dcb8"
      />

      <circle
        cx="${X(last.x)}"
        cy="${Y(last.y)}"
        r="5"
        fill="#e691c0"
      />

      <text x="15" y="20">
        화면 좌표 궤적 · 실제 거리 아님
      </text>

      <text x="15" y="${height - 10}">
        초록: 시작 / 분홍: 종료
      </text>
    </svg>
  `;
};

/* ---------------------------------------------------------
   히트맵

   rows: ["1회", "2회"]
   columns: ["왼쪽 무릎", "오른쪽 무릎"]
   values: [[120, 122], [118, null]]

   색 농도는 값의 크기이며 좋고 나쁨을 뜻하지 않습니다.
   --------------------------------------------------------- */

CM.heatmap = function (
  rows = [],
  columns = [],
  values = [],
  options = {}
) {
  if (!rows.length || !columns.length) {
    return CM.chartEmpty();
  }

  const allValues = values.flat().filter(Number.isFinite);
  const stats = CM.stats(allValues);

  if (!stats.n) {
    return CM.chartEmpty("유효한 히트맵 데이터가 없습니다.");
  }

  const min = Number.isFinite(options.min)
    ? options.min
    : stats.min;

  const max = Number.isFinite(options.max)
    ? options.max
    : Math.max(min + 1, stats.max);

  const unit = options.unit ?? "°";

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">구간</th>
            ${columns.map(column => {
              return `<th scope="col">${CM.chartEscape(column)}</th>`;
            }).join("")}
          </tr>
        </thead>

        <tbody>
          ${rows.map((row, rowIndex) => `
            <tr>
              <th scope="row">${CM.chartEscape(row)}</th>

              ${columns.map((_, columnIndex) => {
                const value =
                  values[rowIndex]?.[columnIndex];

                if (!Number.isFinite(value)) {
                  return "<td>측정 불가</td>";
                }

                const ratio = CM.clamp(
                  (value - min) / Math.max(1e-9, max - min),
                  0,
                  1
                );

                const opacity = 0.08 + ratio * 0.45;

                return `
                  <td
                    style="background:rgba(80,218,242,${opacity})"
                  >
                    ${CM.fmt(value)}${CM.chartEscape(unit)}
                  </td>
                `;
              }).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    <p class="notice">
      색이 진할수록 측정값이 큽니다.
      자세의 좋고 나쁨을 나타내는 색상은 아닙니다.
    </p>
  `;
};

/* ---------------------------------------------------------
   동작 단계 타임라인

   segments:
   [{ label: "하강", start: 0, end: 1.2 }]
   --------------------------------------------------------- */

CM.timeline = function (segments = []) {
  const valid = segments.filter(segment => {
    return (
      Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) &&
      segment.end > segment.start
    );
  });

  if (!valid.length) {
    return CM.chartEmpty("지정된 동작 구간이 없습니다.");
  }

  const start = CM.stats(
    valid.map(segment => segment.start)
  ).min;

  const end = CM.stats(
    valid.map(segment => segment.end)
  ).max;

  const width = 760;
  const height = valid.length * 34 + 50;

  const X = time => {
    return 120 + ((time - start) / (end - start)) * 610;
  };

  return `
    <svg
      class="chart"
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="동작 단계별 시간"
      data-xmin="${start}"
      data-xmax="${end}"
      data-plot-left="120"
      data-plot-right="730"
    >
      ${valid.map((segment, index) => {
        const y = 15 + index * 34;
        const color = CM.chartColor(segment.color, index);

        return `
          <text x="5" y="${y + 15}">
            ${CM.chartEscape(segment.label)}
          </text>

          <rect
            x="${X(segment.start)}"
            y="${y}"
            width="${X(segment.end) - X(segment.start)}"
            height="23"
            rx="4"
            fill="${color}"
          >
            <title>${CM.chartEscape(segment.label)}:
${CM.fmt(segment.start)}~${CM.fmt(segment.end)}초
총 ${CM.fmt(segment.end - segment.start)}초</title>
          </rect>
        `;
      }).join("")}

      <text x="120" y="${height - 10}">
        ${CM.fmt(start)}s
      </text>

      <text
        x="730"
        y="${height - 10}"
        text-anchor="end"
      >
        ${CM.fmt(end)}s
      </text>
    </svg>
  `;
};

/* ---------------------------------------------------------
   그래프 클릭 → 영상 시간 이동

   반환되는 함수를 호출하면 이벤트 연결을 해제합니다.
   --------------------------------------------------------- */

CM.bindChartSeek = function (container, onSeek) {
  if (!container || typeof onSeek !== "function") {
    return function () {};
  }

  function handleClick(event) {
    const svg = event.target.closest(
      "svg[data-xmin][data-xmax]"
    );

    if (!svg || !container.contains(svg)) return;

    const matrix = svg.getScreenCTM();

    if (!matrix) return;

    const point = svg.createSVGPoint();

    point.x = event.clientX;
    point.y = event.clientY;

    const local = point.matrixTransform(
      matrix.inverse()
    );

    const left = Number(svg.dataset.plotLeft);
    const right = Number(svg.dataset.plotRight);
    const min = Number(svg.dataset.xmin);
    const max = Number(svg.dataset.xmax);

    if (
      ![left, right, min, max].every(Number.isFinite) ||
      right <= left ||
      local.x < left ||
      local.x > right
    ) {
      return;
    }

    const ratio = (local.x - left) / (right - left);

    onSeek(min + ratio * (max - min));
  }

  container.addEventListener("click", handleClick);

  return function () {
    container.removeEventListener("click", handleClick);
  };
};

/* ---------------------------------------------------------
   그래프 SVG 다운로드
   --------------------------------------------------------- */

CM.exportChartSVG = function (
  target,
  filename = "codeon-chart.svg"
) {
  const svg =
    target?.tagName?.toLowerCase() === "svg"
      ? target
      : target?.querySelector("svg");

  if (!svg) {
    throw new Error("저장할 그래프가 없습니다.");
  }

  const clone = svg.cloneNode(true);

  clone.setAttribute(
    "xmlns",
    "http://www.w3.org/2000/svg"
  );

  const style = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "style"
  );

  style.textContent = `
    text {
      fill: #8da7b5;
      font-family: sans-serif;
      font-size: 11px;
    }

    .gridline {
      stroke: #254151;
      stroke-width: 1;
    }
  `;

  const background = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect"
  );

  const viewBox = svg.viewBox.baseVal;

  background.setAttribute("x", String(viewBox.x));
  background.setAttribute("y", String(viewBox.y));
  background.setAttribute("width", String(viewBox.width));
  background.setAttribute("height", String(viewBox.height));
  background.setAttribute("fill", "#0c2130");

  clone.insertBefore(background, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);

  const source =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    new XMLSerializer().serializeToString(clone);

  CM.download(
    filename,
    source,
    "image/svg+xml;charset=utf-8"
  );
};