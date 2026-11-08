/* 실버스타 스포츠 과학원 · CODEON MOTION
   reports.js

   자동 리포트:
   - 관절 변화 / 좌우 비교
   - 반복별 가동범위 / 수행 시간
   - 자동 육각형 / 산식 공개
   - 측정 근거 기반 자동 코치 의견
   - 코치 메모 / 추가 훈련 연결
   - CSV / 인쇄

   점수는 동작의 일관성과 기록 상태를 표현합니다.
   임상 평가, 근력 평가, 부상 진단 점수가 아닙니다.
*/

(() => {
  "use strict";

  window.CM = window.CM || {};
  const CM = window.CM;

  const esc = value => CM.escape(String(value ?? ""));
  const finite = Number.isFinite;
  const clamp = value => Math.max(0, Math.min(100, value));

  const joints = {
    knee: "무릎",
    hip: "고관절",
    ankle: "발목",
    elbow: "팔꿈치",
    shoulder: "어깨"
  };

  CM.reportViewNames = {
    side: "측면",
    front: "정면",
    back: "후면"
  };

  CM.reportAxes = [
    "가동범위 일관성",
    "템포 일관성",
    "좌우 각도 유사도",
    "몸통 움직임 일관성",
    "선택 관절 관측률",
    "목표 반복 달성"
  ];

  const fmt = (value, digits = 1) =>
    finite(value) ? value.toFixed(digits) : "—";

  function mean(values) {
    const valid = values.filter(finite);
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) /
      valid.length;
  }

  function stats(values) {
    const valid = values.filter(finite);

    if (!valid.length) {
      return { n: 0, min: null, max: null, mean: null, range: null };
    }

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;

    for (const value of valid) {
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }

    return {
      n: valid.length,
      min,
      max,
      mean: sum / valid.length,
      range: max - min
    };
  }

  function sd(values) {
    const average = mean(values);
    if (average === null) return null;

    return Math.sqrt(
      values.reduce(
        (sum, value) => sum + (value - average) ** 2,
        0
      ) / values.length
    );
  }

  function consistency(values) {
    if (values.length < 3) return null;

    const average = mean(values);
    if (!finite(average) || average <= 0) return null;

    return clamp(100 * (1 - sd(values) / average));
  }

  CM.recordSamples = record =>
    (Array.isArray(record.samples) ? record.samples : [])
      .filter(sample => finite(sample?.t))
      .slice()
      .sort((a, b) => a.t - b.t);

  CM.reportRecordLabel = record => {
    const date = new Date(record.createdAt || record.date);
    const label = finite(date.getTime())
      ? date.toLocaleString("ko-KR")
      : "날짜 없음";

    return [
      record.athleteName || "게스트",
      record.exercise?.name || "운동",
      label
    ].join(" · ");
  };

  CM.reportCompatible = (a, b) =>
    a.id !== b.id &&
    a.athleteId === b.athleteId &&
    (a.exerciseId || a.exercise?.id) ===
      (b.exerciseId || b.exercise?.id) &&
    a.view === b.view &&
    a.measurementVersion === b.measurementVersion &&
    a.angleDefinition === b.angleDefinition;

  CM.csvCell = value => {
    if (finite(value)) return String(value);

    let text = String(value ?? "");

    if (/^[=+\-@\t\r]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  CM.exportRecordCSV = record => {
    const keys = Object.keys(joints).flatMap(joint => [
      `left_${joint}`,
      `right_${joint}`
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

    const rows = [
      [
        "시간_s",
        ...keys,
        ...metricKeys,
        "수동수정",
        "바벨_x",
        "바벨_y"
      ],
      ...CM.recordSamples(record).map(sample => [
        sample.t,
        ...keys.map(key => sample.angles?.[key]),
        ...metricKeys.map(key => sample.metrics?.[key]),
        sample.manual ? "예" : "아니오",
        sample.bar?.x,
        sample.bar?.y
      ])
    ];

    const csv = "\uFEFF" + rows.map(row =>
      row.map(CM.csvCell).join(",")
    ).join("\r\n");

    CM.download(
      `codeon-analysis-${record.id}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
  };

  function valueOf(sample, joint, side) {
    return sample.angles?.[`${side}_${joint}`];
  }

  function trunkOf(sample, side) {
    return sample.metrics?.[`${side}_trunk`];
  }

  function validRepetitions(record) {
    return (Array.isArray(record.repetitions)
      ? record.repetitions
      : []
    ).filter(rep =>
      finite(rep.start) &&
      finite(rep.end) &&
      rep.end > rep.start
    );
  }

  /*
    반복 구간의 첫/마지막 측정이 경계에서 0.25초 이내이고,
    중간 측정 공백이 0.8초 이하일 때만 범위를 계산합니다.
  */
  function intervalRange(samples, start, end, getter) {
    const selected = samples.filter(sample =>
      sample.t >= start &&
      sample.t <= end &&
      finite(getter(sample))
    );

    if (selected.length < 3) return null;
    if (selected[0].t - start > 0.25) return null;
    if (end - selected[selected.length - 1].t > 0.25) return null;

    for (let i = 1; i < selected.length; i++) {
      if (selected[i].t - selected[i - 1].t > 0.8) {
        return null;
      }
    }

    return stats(selected.map(getter)).range;
  }

  function buildMetrics(record, samples, joint, side) {
    const reps = validRepetitions(record);

    const repetitionRows = reps.map((rep, index) => ({
      index: index + 1,
      start: rep.start,
      end: rep.end,
      duration: rep.end - rep.start,
      rom: intervalRange(
        samples,
        rep.start,
        rep.end,
        sample => valueOf(sample, joint, side)
      ),
      trunkRange: intervalRange(
        samples,
        rep.start,
        rep.end,
        sample => trunkOf(sample, side)
      )
    }));

    const roms = repetitionRows.map(row => row.rom).filter(finite);
    const durations = repetitionRows.map(row => row.duration);
    const trunks = repetitionRows
      .map(row => row.trunkRange)
      .filter(finite);

    const paired = samples.filter(sample =>
      finite(valueOf(sample, joint, "left")) &&
      finite(valueOf(sample, joint, "right"))
    );

    const differences = paired.map(sample =>
      Math.abs(
        valueOf(sample, joint, "left") -
        valueOf(sample, joint, "right")
      )
    );

    const diffMean = mean(differences);
    const validCount = samples.filter(sample =>
      finite(valueOf(sample, joint, side))
    ).length;

    const coverage = samples.length
      ? 100 * validCount / samples.length
      : null;

    const target = Number(record.targetReps);
    const bilateralView = ["front", "back"].includes(record.view);

    // 좌우 각도 유사도는 사용자 참고용 선형 변환입니다.
    // 평균 차이 0° = 100, 30° 이상 = 0.
    // 30°는 의학적 허용치가 아닙니다.
    const bilateralScore =
      bilateralView && paired.length >= 10
        ? clamp(100 * (1 - diffMean / 30))
        : null;

    const targetScore =
      record.exercise?.mode === "reps" &&
      finite(target) &&
      target > 0
        ? clamp(100 * reps.length / target)
        : null;

    const axes = [
      {
        name: CM.reportAxes[0],
        value: consistency(roms)
      },
      {
        name: CM.reportAxes[1],
        value: consistency(durations)
      },
      {
        name: CM.reportAxes[2],
        value: bilateralScore
      },
      {
        name: CM.reportAxes[3],
        value: consistency(trunks)
      },
      {
        name: CM.reportAxes[4],
        value: samples.length >= 10 ? coverage : null
      },
      {
        name: CM.reportAxes[5],
        value: targetScore
      }
    ];

    return {
      axes,
      repetitionRows,
      reps,
      roms,
      durations,
      paired,
      diffMean,
      differences,
      coverage,
      validCount,
      bilateralView,
      left: stats(samples.map(sample =>
        valueOf(sample, joint, "left")
      )),
      right: stats(samples.map(sample =>
        valueOf(sample, joint, "right")
      ))
    };
  }

  /*
    자동 코치 의견은 측정값을 문장으로 설명합니다.
    특정 자세를 정상/비정상으로 진단하지 않습니다.
  */
  function buildFeedback(record, metrics, joint, side) {
    const notes = [];
    const drills = [];
    const jointName = joints[joint];
    const sideName = side === "left" ? "왼쪽" : "오른쪽";
    const selected = metrics[side];

    if (selected.n) {
      notes.push({
        title: `${sideName} ${jointName} 움직임`,
        text:
          `관측 각도는 ${fmt(selected.min)}~` +
          `${fmt(selected.max)}°이며, 전체 기록의 변화 폭은 ` +
          `${fmt(selected.range)}°입니다. ` +
          "준비 자세와 휴식 구간도 포함된 값이므로 " +
          "반복별 그래프와 함께 확인하세요."
      });
    } else {
      notes.push({
        title: "측정 부족",
        text:
          `${sideName} ${jointName} 각도를 확인할 수 없습니다. ` +
          "촬영 구도와 관절 가림을 확인한 뒤 다시 분석하세요."
      });
    }

    if (metrics.roms.length >= 3) {
      const rom = stats(metrics.roms);

      notes.push({
        title: "반복별 가동범위",
        text:
          `${metrics.roms.length}개 유효 반복의 평균 변화 폭은 ` +
          `${fmt(rom.mean)}°이고, 반복 간 최댓값과 최솟값의 차이는 ` +
          `${fmt(rom.range)}°입니다. ` +
          "의도한 동작 깊이가 반복마다 같았는지 영상을 확인하세요."
      });

      drills.push({
        title: "동작 범위 확인 연습",
        text:
          `${record.exercise?.name || "선택 운동"}의 ` +
          "시작·종료 위치를 화면 기준선으로 확인하며 " +
          "같은 범위를 의도적으로 반복해 보세요. " +
          "목표 각도와 횟수는 코치와 정하세요."
      });
    } else {
      notes.push({
        title: "반복 비교 자료 부족",
        text:
          "가동범위 일관성을 계산하려면 측정 공백이 적은 " +
          "유효 반복이 3개 이상 필요합니다. " +
          "자동 반복 구간이 실제 동작과 일치하는지도 확인하세요."
      });
    }

    if (metrics.durations.length >= 3) {
      const timing = stats(metrics.durations);

      notes.push({
        title: "반복 속도",
        text:
          `반복 시간은 평균 ${fmt(timing.mean, 2)}초, ` +
          `최소 ${fmt(timing.min, 2)}초, ` +
          `최대 ${fmt(timing.max, 2)}초입니다. ` +
          "속도를 일정하게 수행하는 과제였다면 " +
          "차이가 큰 반복을 다시 확인하세요."
      });

      drills.push({
        title: "일정한 템포 연습",
        text:
          "코치가 정한 박자에 맞춰 같은 운동을 수행하고 " +
          "다시 촬영해 반복 시간을 비교하세요. " +
          "빠르게 수행해야 하는 점프 종목에는 " +
          "느린 템포를 일괄 적용하지 않습니다."
      });
    }

    if (metrics.bilateralView && metrics.paired.length >= 10) {
      const differences = stats(metrics.differences);

      notes.push({
        title: "좌우 차이 확인",
        text:
          `같은 시점의 좌우 ${jointName} 각도 차이는 평균 ` +
          `${fmt(metrics.diffMean)}°, 최대 ` +
          `${fmt(differences.max)}°입니다. ` +
          "교대·편측 운동에서는 의도한 차이일 수 있고, " +
          "카메라 위치와 가림도 영향을 줍니다. " +
          "이 값만으로 약한 쪽을 정할 수는 없습니다."
      });

      drills.push({
        title: "좌우 비교 재촬영",
        text:
          "카메라를 몸 중앙에 맞추고 같은 구도에서 " +
          "좌우 동작을 각각 촬영하세요. " +
          "같은 동작 단계끼리 비교한 뒤 추가 훈련을 선택하세요."
      });
    } else {
      notes.push({
        title: "좌우 평가 보류",
        text:
          "측면 촬영이거나 양쪽 관절의 동시 측정값이 부족해 " +
          "좌우 유사도 점수를 만들지 않았습니다."
      });
    }

    if (finite(metrics.coverage)) {
      notes.push({
        title: "기록의 관측 상태",
        text:
          `저장된 ${metrics.validCount}개 유효 표본을 기준으로 ` +
          `선택 관절 관측률은 ${fmt(metrics.coverage)}%입니다. ` +
          "전체 영상 프레임의 분석률이나 측정 정확도를 뜻하지 않습니다."
      });
    }

    if (finite(metrics.axes[5].value)) {
      notes.push({
        title: "목표 반복",
        text:
          `목표 ${record.targetReps}회 중 ` +
          `${metrics.reps.length}개 반복 구간이 저장되어 있습니다. ` +
          "자동 감지 결과라면 실제 횟수와 일치하는지 확인하세요."
      });
    }

    if (!drills.length) {
      drills.push({
        title: "분석 가능한 기록 만들기",
        text:
          "분석할 관절이 화면 안에 충분히 보이도록 촬영하고, " +
          "실제 동작에 맞게 반복 구간을 확인하세요."
      });
    }

    return { notes, drills };
  }

  CM.reportObservations = (samples, joint = "knee") => {
    const paired = samples.filter(sample =>
      finite(sample.angles?.[`left_${joint}`]) &&
      finite(sample.angles?.[`right_${joint}`])
    );

    return {
      left: stats(samples.map(sample =>
        sample.angles?.[`left_${joint}`]
      )),
      right: stats(samples.map(sample =>
        sample.angles?.[`right_${joint}`]
      )),
      pairedCount: paired.length,
      meanDifference: mean(paired.map(sample =>
        Math.abs(
          sample.angles[`left_${joint}`] -
          sample.angles[`right_${joint}`]
        )
      ))
    };
  };

  CM.renderReports = async () => {
    // 같은 화면을 다시 그릴 때 이전 이벤트를 해제합니다.
    if (typeof CM.reportsCleanup === "function") {
      CM.reportsCleanup();
    }

    await CM.loadExercises();

    const records = await CM.db.all("records");
    records.sort((a, b) =>
      (Date.parse(b.createdAt || b.date) || 0) -
      (Date.parse(a.createdAt || a.date) || 0)
    );

    const main = document.querySelector("#main");

    if (!records.length) {
      main.innerHTML =
        CM.heading("분석 리포트", "AUTOMATIC REPORT") +
        CM.empty("분석 화면에서 기록을 저장하면 리포트가 생성됩니다.");
      return;
    }

    let record =
      records.find(item => item.id === CM.selectedRecord) ||
      records.find(item =>
        item.athleteId === CM.selectedAthlete
      ) ||
      records[0];

    CM.selectedRecord = record.id;

    const controller = new AbortController();
    const signal = controller.signal;

    let active = true;
    let dirty = false;
    let saving = false;

    const initialMetric = record.exercise?.metric;
    let joint = Object.hasOwn(joints, initialMetric)
      ? initialMetric
      : "knee";

    let side = "left";

    const $ = selector => main.querySelector(selector);

    main.innerHTML = `
      ${CM.heading(
        "자동 분석 리포트",
        "SILVERSTAR · CODEON MOTION",
        `
          <button id="rp-save" class="primary">코치 메모 저장</button>
          <button id="rp-csv">CSV</button>
          <button id="rp-print">인쇄 / PDF</button>
        `
      )}

      <section class="panel no-print" style="margin-bottom:18px">
        <div class="grid g3">
          <label>
            분석 기록
            <select id="rp-record">
              ${records.map(item => `
                <option value="${esc(item.id)}"
                  ${item.id === record.id ? "selected" : ""}>
                  ${esc(CM.reportRecordLabel(item))}
                </option>
              `).join("")}
            </select>
          </label>

          <label>
            분석 관절
            <select id="rp-joint">
              ${Object.entries(joints).map(([key, name]) => `
                <option value="${key}"
                  ${key === joint ? "selected" : ""}>
                  ${name}
                </option>
              `).join("")}
            </select>
          </label>

          <label>
            육각형 기준 방향
            <select id="rp-side">
              <option value="left">왼쪽</option>
              <option value="right">오른쪽</option>
            </select>
          </label>
        </div>
      </section>

      <div id="rp-content"></div>

      <section class="panel report-section"
        id="rp-section-coach" style="margin-top:18px">
        <h2>코치 추가 메모</h2>
        <p class="muted">
          자동 의견에 코치의 관찰과 다음 훈련 목표를 덧붙일 수 있습니다.
        </p>

        <div class="grid g2">
          <label>
            잘한 점
            <textarea id="rp-strengths" rows="4"></textarea>
          </label>
          <label>
            우선 확인할 점
            <textarea id="rp-priorities" rows="4"></textarea>
          </label>
          <label>
            코치 피드백
            <textarea id="rp-feedback" rows="5"></textarea>
          </label>
          <label>
            다음 목표
            <textarea id="rp-goal" rows="5"></textarea>
          </label>
        </div>

        <label style="display:block;margin-top:12px">
          기록 메모
          <textarea id="rp-memo" rows="3"></textarea>
        </label>

        <div class="row no-print"
          style="margin-top:14px;gap:8px;flex-wrap:wrap">
          <button id="rp-training" class="primary">
            추가 훈련 계획 만들기
          </button>
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
      const node = $(`#${id}`);
      node.value = record[key] || "";
      node.addEventListener("input", () => {
        dirty = true;
      }, { signal });
    }

    let currentFeedback = null;
    let currentMetrics = null;

    function panel(title, content) {
      return `
        <section class="panel report-section"
          style="margin-bottom:18px">
          <h2>${esc(title)}</h2>
          ${content}
        </section>
      `;
    }

    function draw() {
      const samples = CM.recordSamples(record);
      const metrics = buildMetrics(record, samples, joint, side);
      const feedback = buildFeedback(record, metrics, joint, side);

      currentFeedback = feedback;
      currentMetrics = metrics;

      const angleSeries = [
        {
          name: `왼쪽 ${joints[joint]}`,
          color: "#50daf2",
          data: samples.map(sample => ({
            x: sample.t,
            y: valueOf(sample, joint, "left") ?? null
          }))
        },
        {
          name: `오른쪽 ${joints[joint]}`,
          color: "#f58cce",
          data: samples.map(sample => ({
            x: sample.t,
            y: valueOf(sample, joint, "right") ?? null
          }))
        }
      ];

      const signedDifference = samples.map(sample => {
        const left = valueOf(sample, joint, "left");
        const right = valueOf(sample, joint, "right");

        return {
          x: sample.t,
          y: finite(left) && finite(right) ? left - right : null
        };
      });

      const snapshots = (record.snapshots || []).filter(snapshot =>
        typeof snapshot.image === "string" &&
        /^data:image\/(png|jpeg|webp);base64,/i.test(snapshot.image)
      );

      const manualCount = samples.filter(sample => sample.manual).length;

      const statsRows = Object.entries(joints).map(([key, name]) => {
        const left = stats(samples.map(sample =>
          valueOf(sample, key, "left")
        ));
        const right = stats(samples.map(sample =>
          valueOf(sample, key, "right")
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

      $("#rp-content").innerHTML = `
        ${panel("기록 요약", `
          <div class="grid g3">
            <div>
              <span class="muted">선수</span>
              <h3>${esc(record.athleteName || "게스트")}</h3>
            </div>
            <div>
              <span class="muted">운동</span>
              <h3>${esc(record.exercise?.name || "운동")}</h3>
            </div>
            <div>
              <span class="muted">촬영 방향</span>
              <h3>
                ${esc(CM.reportViewNames[record.view] || "미지정")}
              </h3>
            </div>
          </div>

          <p class="muted">
            저장 표본 ${samples.length}개 ·
            수동 수정 표본 ${manualCount}개 ·
            반복 구간 ${metrics.reps.length}개
          </p>
          <p class="muted">
            기준 관절: ${joints[joint]} /
            ${side === "left" ? "왼쪽" : "오른쪽"}
          </p>
        `)}

        ${panel("자동 육각형 분석", `
          <div class="grid g2">
            <div class="chart">${CM.radar(metrics.axes)}</div>
            <div>
              <table>
                <thead>
                  <tr><th>항목</th><th>참고 점수</th></tr>
                </thead>
                <tbody>
                  ${metrics.axes.map(axis => `
                    <tr>
                      <td>${esc(axis.name)}</td>
                      <td>
                        ${
                          finite(axis.value)
                            ? `${fmt(axis.value, 0)} / 100`
                            : "측정 부족·적용 제외"
                        }
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>

              <p class="muted">
                점수가 높아도 올바른 자세나 높은 경기력을
                보장하지 않습니다. 일관되게 잘못 수행한 동작도
                일관성 점수는 높을 수 있습니다.
              </p>
            </div>
          </div>

          <details>
            <summary>점수 계산 기준 보기</summary>
            <ul>
              <li>
                가동범위·템포·몸통 일관성:
                100 × (1 − 표준편차 ÷ 평균).
                0~100으로 제한하며 유효 반복 3개 이상이 필요합니다.
              </li>
              <li>
                몸통 일관성은 반복마다 관측된 몸통 각도 변화 폭을
                비교합니다. 몸통을 덜 움직였다는 점수가 아닙니다.
              </li>
              <li>
                좌우 유사도:
                100 × (1 − 평균 절대 각도 차이 ÷ 30°).
                30°는 프로그램의 표시 기준이며 의학적 허용치가 아닙니다.
                정면·후면에서 동시 유효 표본 10개 이상일 때만 계산합니다.
              </li>
              <li>
                관측률: 선택 관절 유효 표본 ÷ 저장 표본 × 100.
                전체 영상 분석률이나 정확도가 아닙니다.
              </li>
              <li>
                목표 달성: 저장 반복 수 ÷ 설정 목표 × 100.
                반복형 운동만 적용하며 최대 100입니다.
              </li>
              <li>
                자동 반복 구간의 오류는 점수에도 영향을 줍니다.
                교대·편측 운동은 좌우 유사도를 수행 평가로 사용하지 마세요.
              </li>
            </ul>
          </details>
        `)}

        ${panel("관절 각도 변화", `
          <div class="chart">
            ${CM.lineChart(angleSeries, { unit: "°", maxGap: 0.8 })}
          </div>
          <p class="muted">
            가로축은 시간, 세로축은 영상 기준 관절 각도입니다.
            측정이 끊긴 구간은 연결하지 않습니다.
          </p>
        `)}

        ${panel("관절별 관측 범위", `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>관절</th>
                  <th>왼쪽 최소 / 최대°</th>
                  <th>왼쪽 변화 폭°</th>
                  <th>오른쪽 최소 / 최대°</th>
                  <th>오른쪽 변화 폭°</th>
                </tr>
              </thead>
              <tbody>${statsRows}</tbody>
            </table>
          </div>
          <p class="muted">
            전체 기록에서 관측된 범위이며,
            신체의 최대 가동범위를 측정한 검사는 아닙니다.
          </p>
        `)}

        ${panel("좌우 각도 차이", `
          <div class="chart">
            ${CM.lineChart([{
              name: "왼쪽 − 오른쪽",
              color: "#f5d76e",
              data: signedDifference
            }], {
              unit: "°",
              min: -180,
              max: 180,
              maxGap: 0.8
            })}
          </div>
          <p class="muted">
            양수는 왼쪽 각도가 더 크고, 음수는 오른쪽 각도가 더 큽니다.
            카메라에 보이는 2D 각도의 차이입니다.
          </p>
        `)}

        ${panel("반복별 가동범위", `
          <div class="chart">
            ${CM.barChart(metrics.repetitionRows.map(row => ({
              label: `${row.index}회`,
              value: row.rom,
              color: "#50daf2"
            })), "°")}
          </div>
        `)}

        ${panel("반복별 수행 시간", `
          <div class="chart">
            ${CM.barChart(metrics.repetitionRows.map(row => ({
              label: `${row.index}회`,
              value: row.duration,
              color: "#f58cce"
            })), "s")}
          </div>
        `)}

        ${panel("몸통 기울기 변화", `
          <div class="chart">
            ${CM.lineChart([
              {
                name: "왼쪽 기준",
                color: "#50daf2",
                data: samples.map(sample => ({
                  x: sample.t,
                  y: trunkOf(sample, "left") ?? null
                }))
              },
              {
                name: "오른쪽 기준",
                color: "#f58cce",
                data: samples.map(sample => ({
                  x: sample.t,
                  y: trunkOf(sample, "right") ?? null
                }))
              }
            ], { unit: "°", maxGap: 0.8 })}
          </div>
          <p class="muted">
            수직선에 대한 몸통 기울기입니다.
            운동과 촬영 방향에 따라 의미가 달라집니다.
          </p>
        `)}

        ${panel("자동 코치 피드백", `
          <p class="muted">
            저장된 측정값으로 생성한 설명입니다.
            낮은 점수를 곧바로 근력 부족이나 잘못된 자세로 해석하지 않습니다.
          </p>
          <div class="grid g2">
            ${feedback.notes.map(note => `
              <article class="panel">
                <h3>${esc(note.title)}</h3>
                <p>${esc(note.text)}</p>
              </article>
            `).join("")}
          </div>
        `)}

        ${panel("다음 훈련을 위한 제안", `
          <div class="grid g2">
            ${feedback.drills.map(drill => `
              <article class="panel">
                <h3>${esc(drill.title)}</h3>
                <p>${esc(drill.text)}</p>
              </article>
            `).join("")}
          </div>
          <p class="muted">
            아래 ‘추가 훈련 계획 만들기’를 누르면
            이 제안을 참고 내용으로 가져옵니다.
            실제 종목·중량·횟수는 훈련 화면에서 선택하세요.
          </p>
        `)}

        ${panel("저장된 동작 사진", snapshots.length
          ? `
            <div class="grid g3">
              ${snapshots.map(snapshot => `
                <figure style="margin:0">
                  <img
                    class="snapshot"
                    style="width:100%;border-radius:10px"
                    src="${esc(snapshot.image)}"
                    alt="저장된 동작 사진"
                    loading="lazy">
                  <figcaption class="muted">
                    ${fmt(snapshot.t, 2)}초
                  </figcaption>
                </figure>
              `).join("")}
            </div>
          `
          : CM.empty("분석 화면에서 저장한 동작 사진이 없습니다.")
        )}
      `;
    }

    async function saveCoach() {
      if (saving) return false;

      saving = true;
      $("#rp-save").disabled = true;

      try {
        const latest = await CM.db.get("records", record.id);

        if (!latest) {
          throw new Error("원본 분석 기록을 찾을 수 없습니다.");
        }

        const updates = {};

        for (const [id, key] of Object.entries(fields)) {
          updates[key] = $(`#${id}`).value.trim();
        }

        const updated = {
          ...latest,
          ...updates,
          updatedAt: new Date().toISOString(),
          autoReport: {
            version: "descriptive-v1",
            generatedAt: new Date().toISOString(),
            joint,
            side,
            axes: currentMetrics.axes,
            notes: currentFeedback.notes,
            drills: currentFeedback.drills
          }
        };

        await CM.db.put("records", updated);

        record = updated;
        dirty = false;
        CM.toast("코치 메모와 자동 분석 요약을 저장했습니다.");
        return true;
      } catch (error) {
        console.error(error);
        CM.toast(error.message || "저장하지 못했습니다.");
        return false;
      } finally {
        saving = false;
        if (active) $("#rp-save").disabled = false;
      }
    }

    $("#rp-save").addEventListener("click", saveCoach, { signal });

    $("#rp-joint").addEventListener("change", event => {
      joint = event.target.value;
      draw();
    }, { signal });

    $("#rp-side").addEventListener("change", event => {
      side = event.target.value;
      draw();
    }, { signal });

    $("#rp-record").addEventListener("change", async event => {
      if (saving) {
        event.target.value = record.id;
        CM.toast("저장이 끝난 뒤 선택해 주세요.");
        return;
      }

      if (
        dirty &&
        !window.confirm("저장하지 않은 코치 메모를 버리고 이동할까요?")
      ) {
        event.target.value = record.id;
        return;
      }

      CM.selectedRecord = event.target.value;
      await CM.renderReports();
    }, { signal });

    $("#rp-csv").addEventListener("click", () => {
      CM.exportRecordCSV(record);
    }, { signal });

    $("#rp-compare").addEventListener("click", () => {
      location.hash = "compare";
    }, { signal });

    $("#rp-training").addEventListener("click", async () => {
      if (saving) return;
      if (dirty && !(await saveCoach())) return;

      const priorities = $("#rp-priorities").value.trim();
      const goal = $("#rp-goal").value.trim();

      CM.selectedAthlete = record.athleteId || "";

      CM.trainingDraft = {
        athleteId: record.athleteId || "",
        athleteName: record.athleteName || "게스트",
        sourceRecordId: record.id,
        reason: priorities || currentFeedback.notes.map(note =>
          `${note.title}: ${note.text}`
        ).join("\n\n"),
        goal: goal || currentFeedback.drills.map(drill =>
          `${drill.title}: ${drill.text}`
        ).join("\n\n")
      };

      location.hash = "training";
    }, { signal });

    let printCopies = [];

    function restorePrint() {
      for (const { node, copy, oldDisplay } of printCopies) {
        node.style.display = oldDisplay;
        copy.remove();
      }
      printCopies = [];
    }

    $("#rp-print").addEventListener("click", async () => {
      if (saving) return;
      if (dirty && !(await saveCoach())) return;

      restorePrint();

      for (const id of Object.keys(fields)) {
        const node = $(`#${id}`);
        const copy = document.createElement("div");

        copy.textContent = node.value || "입력 없음";
        copy.style.whiteSpace = "pre-wrap";
        copy.style.overflowWrap = "anywhere";
        copy.style.padding = "10px 0";

        const oldDisplay = node.style.display;
        node.style.display = "none";
        node.after(copy);

        printCopies.push({ node, copy, oldDisplay });
      }

      try {
        window.print();
      } catch (error) {
        restorePrint();
        CM.toast("인쇄 창을 열지 못했습니다.");
      }
    }, { signal });

    window.addEventListener("afterprint", restorePrint, { signal });

    function beforeUnload(event) {
      if (!dirty && !saving) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", beforeUnload, { signal });

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
      CM.reportsCanLeave = null;
      CM.reportsCleanup = null;
    };

    draw();
  };

  CM.renderFeedback = async () => {
    await CM.renderReports();

    document.querySelector("#rp-section-coach")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };
})();