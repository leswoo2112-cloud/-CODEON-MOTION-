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
/*
  CODEON MOTION
  리포트 확장: 관절 탐색 + 연구 근거 피드백

  기존 reports.js 마지막 줄 아래에 추가하세요.
  기존 reports.js를 지우지 않습니다.

  연구 내용:
  - 확인한 논문 초록을 바탕으로 요약
  - 연구에서 검증하지 않은 정상 각도는 생성하지 않음
  - 운동 수행의 개인별 정상/비정상 진단에 사용하지 않음
*/

(() => {
  "use strict";

  const CM = window.CM;

  if (!CM || typeof CM.renderReports !== "function") {
    console.error("기존 reports.js를 먼저 불러와야 합니다.");
    return;
  }

  if (CM.researchReportInstalled) return;
  CM.researchReportInstalled = true;

  const baseRenderReports = CM.renderReports;
  const finite = Number.isFinite;
  const escape = value => CM.escape(String(value ?? ""));

  const parts = {
    shoulder: {
      name: "어깨",
      points: { left: 11, right: 12 },
      angle: true
    },
    elbow: {
      name: "팔꿈치",
      points: { left: 13, right: 14 },
      angle: true
    },
    wrist: {
      name: "손목",
      points: { left: 15, right: 16 },
      angle: false
    },
    hip: {
      name: "고관절",
      points: { left: 23, right: 24 },
      angle: true
    },
    knee: {
      name: "무릎",
      points: { left: 25, right: 26 },
      angle: true
    },
    ankle: {
      name: "발목",
      points: { left: 27, right: 28 },
      angle: true
    },
    trunk: {
      name: "몸통",
      points: null,
      angle: true
    },
    pelvis: {
      name: "골반",
      points: null,
      angle: true
    }
  };

  const jointTriples = {
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

  const skeletonEdges = [
    [11, 12],
    [11, 13], [13, 15],
    [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27],
    [24, 26], [26, 28],
    [27, 29], [29, 31], [27, 31],
    [28, 30], [30, 32], [28, 32]
  ];

  const leftIds = new Set([
    11, 13, 15, 23, 25, 27, 29, 31
  ]);

  const studies = {
    squatKnee: {
      title:
        "Effect of knee position on hip and knee torques " +
        "during the barbell squat",
      author: "Fry ほか".replace("ほか", "외"),
      year: 2003,
      population: "웨이트 훈련 경험이 있는 성인 남성 7명",
      url: "https://pubmed.ncbi.nlm.nih.gov/14636100/",
      finding:
        "평행 바벨 스쿼트에서 무릎의 전진을 제한했을 때 " +
        "무릎 토크는 감소하고 고관절 토크는 증가했습니다.",
      limit:
        "특정 조건의 소규모 성인 연구입니다. " +
        "무릎이 발끝을 넘는다는 이유만으로 실패 판정을 내리는 " +
        "근거로 사용하지 않습니다."
    },
    squatTrunk: {
      title:
        "Targeting the hip and/or knee extensors during the back squat " +
        "in males and females: A repeated measures decision tree analysis",
      author: "백 스쿼트 반복측정 연구",
      year: 2025,
      population: "건강한 참가자 16명",
      url: "https://pubmed.ncbi.nlm.nih.gov/40157154/",
      finding:
        "몸통과 정강이 기울기의 상대적 차이, 무릎 굽힘 정도가 " +
        "고관절·무릎 폄 모멘트의 비율과 관련되었습니다.",
      limit:
        "몸통 각도 하나의 정상 범위를 제시한 연구가 아닙니다. " +
        "이 앱은 관절 모멘트나 실제 부하를 직접 측정하지 않습니다."
    },
    pushHand: {
      title: "Hand position affects elbow joint load during push-up exercise",
      author: "Donkers 외",
      year: 1993,
      population: "건강한 성인 남성 9명",
      url: "https://pubmed.ncbi.nlm.nih.gov/8514808/",
      finding:
        "여섯 가지 손 위치에서 푸시업을 비교했을 때 " +
        "팔꿈치에 작용하는 힘과 토크가 달라졌습니다.",
      limit:
        "특정 팔꿈치 각도 하나를 모두에게 안전한 정답으로 " +
        "지정한 연구가 아닙니다."
    },
    pushLoad: {
      title: "Kinetic analysis of several variations of push-ups",
      author: "Ebben 외",
      year: 2011,
      population: "운동을 하는 성인 23명",
      url: "https://pubmed.ncbi.nlm.nih.gov/21873902/",
      finding:
        "손을 높인 푸시업과 무릎을 댄 푸시업에서는 " +
        "일반 푸시업보다 낮은 최대 수직 지면반력이 관측되었습니다.",
      limit:
        "외부 부하를 비교한 결과입니다. " +
        "개인의 통증 개선이나 부상 예방 효과를 증명한 것은 아닙니다."
    }
  };

  function format(value, digits = 1) {
    return finite(value) ? value.toFixed(digits) : "—";
  }

  function summary(values) {
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
      ? { min, max, mean: sum / count, count, range: max - min }
      : { min: null, max: null, mean: null, count: 0, range: null };
  }

  function pointValid(point, threshold) {
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

  function pointsValid(sample, ids, threshold) {
    return ids.every(id => pointValid(sample.points?.[id], threshold));
  }

  function averagePoint(sample, ids, threshold) {
    if (!pointsValid(sample, ids, threshold)) return null;

    return {
      x: ids.reduce((sum, id) => sum + sample.points[id].x, 0) / ids.length,
      y: ids.reduce((sum, id) => sum + sample.points[id].y, 0) / ids.length
    };
  }

  /*
    위치 그래프는 영상 너비·높이에 대한 백분율입니다.
    실제 cm 단위 이동 거리가 아닙니다.
  */
  function sampleValue(sample, part, side, mode, threshold) {
    const definition = parts[part];

    if (mode !== "angle") {
      let point = null;

      if (part === "trunk") {
        const ids = side === "left" ? [11, 23] : [12, 24];
        point = averagePoint(sample, ids, threshold);
      } else if (part === "pelvis") {
        point = averagePoint(sample, [23, 24], threshold);
      } else {
        const candidate = sample.points?.[definition.points[side]];
        if (pointValid(candidate, threshold)) point = candidate;
      }

      if (!point) return null;
      return (mode === "x" ? point.x : point.y) * 100;
    }

    if (part === "wrist") return null;

    if (part === "trunk") {
      const ids = side === "left" ? [11, 23] : [12, 24];
      if (!pointsValid(sample, ids, threshold)) return null;

      const value = sample.metrics?.[`${side}_trunk`];
      return finite(value) ? value : null;
    }

    if (part === "pelvis") {
      if (!pointsValid(sample, [23, 24], threshold)) return null;

      const value = sample.metrics?.hipTilt;
      return finite(value) ? value : null;
    }

    if (!pointsValid(sample, jointTriples[part][side], threshold)) {
      return null;
    }

    const value = sample.angles?.[`${side}_${part}`];
    return finite(value) ? value : null;
  }

  /*
    표시용 이동평균:
    - 원본 기록은 수정하지 않습니다.
    - null과 0.8초를 넘는 공백은 연결하지 않습니다.
    - 구간 안의 연속된 최대 5개 표본을 평균 냅니다.
  */
  function smoothLine(data) {
    const result = data.map(point => ({ ...point }));
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
      ) {
        end++;
      }

      for (let index = start; index <= end; index++) {
        const from = Math.max(start, index - 2);
        const to = Math.min(end, index + 2);

        let sum = 0;
        for (let cursor = from; cursor <= to; cursor++) {
          sum += data[cursor].y;
        }

        result[index].y = sum / (to - from + 1);
      }

      start = end + 1;
    }

    return result;
  }

  function exerciseFamily(record) {
    const name = record.exercise?.name || "";

    if (
      record.exercise?.icon === "squat" ||
      /스쿼트|스쾃|squat/i.test(name)
    ) return "squat";

    if (
      record.exercise?.icon === "pushup" ||
      /푸시업|푸쉬업|팔굽혀|push.?up/i.test(name)
    ) return "pushup";

    return "other";
  }

  function researchFor(record) {
    const family = exerciseFamily(record);

    if (family === "squat") {
      return {
        papers: [studies.squatKnee, studies.squatTrunk],
        interpretation:
          "스쿼트는 무릎의 전진, 몸통과 정강이 기울기, 깊이를 " +
          "함께 확인해야 합니다. 현재 선택한 각도만으로 " +
          "정상·비정상 또는 관절 부하를 판정하지 않습니다.",
        practice:
          "코칭 적용 제안: 같은 중량·발 간격·촬영 구도에서 " +
          "코치가 정한 동작 범위를 수행하고 다시 촬영하세요. " +
          "무릎을 발끝 뒤에 두기 위해 억지로 제한하지 말고, " +
          "몸통과 정강이 움직임을 함께 확인하세요.",
        practiceLimit:
          "이 비교 촬영 절차 자체가 논문에서 효과 검증된 " +
          "개인별 교정 프로그램이라는 뜻은 아닙니다."
      };
    }

    if (family === "pushup") {
      return {
        papers: [studies.pushHand, studies.pushLoad],
        interpretation:
          "푸시업은 손 위치와 지지 높이에 따라 부하가 달라집니다. " +
          "팔꿈치 각도 하나만으로 잘못된 자세라고 단정하지 않습니다.",
        practice:
          "코칭 적용 제안: 일반 푸시업 수행이 어렵다면 " +
          "안정적인 높은 지지대에 손을 올리는 변형을 코치와 검토하세요. " +
          "같은 손 위치에서 촬영해 반복별 팔꿈치 움직임을 비교하세요.",
        practiceLimit:
          "손을 높인 변형의 낮은 외부 부하는 연구에 근거하지만, " +
          "현재 영상으로 특정 근육 약화나 필요한 지지 높이를 " +
          "자동 결정할 수는 없습니다."
      };
    }

    return {
      papers: [],
      interpretation:
        "이 운동에 직접 적용할 논문 규칙은 아직 등록하지 않았습니다. " +
        "관측값은 제공하지만 다른 운동의 각도 기준을 가져와 " +
        "좋다·나쁘다를 판정하지 않습니다.",
      practice:
        "코칭 적용 제안: 같은 촬영 구도와 운동 조건에서 " +
        "코치가 정한 목표 동작과 비교하세요.",
      practiceLimit:
        "이 종목의 연구 근거를 추가하기 전에는 " +
        "논문 기반 교정이라고 표시하지 않습니다."
    };
  }

  CM.renderReports = async function (...args) {
    await baseRenderReports.apply(CM, args);

    const main = document.querySelector("#main");
    if (!main?.querySelector("#rp-content")) return;

    const record = await CM.db.get("records", CM.selectedRecord);
    if (!record) return;

    const samples = CM.recordSamples(record);
    if (!samples.length) return;

    const controller = new AbortController();
    const signal = controller.signal;
    const previousCleanup = CM.reportsCleanup;

    let unbindSeek = null;

    const state = {
      part: "knee",
      side: "both",
      mode: "angle",
      smooth: false,
      threshold: 0.75,
      start: samples[0].t,
      end: samples[samples.length - 1].t,
      time: samples[0].t
    };

    const metric = record.exercise?.metric;
    if (Object.hasOwn(parts, metric)) state.part = metric;

    const research = researchFor(record);

    let currentObservation = "";

    function selectedSides() {
      if (state.part === "pelvis") return ["left"];
      return state.side === "both" ? ["left", "right"] : [state.side];
    }

    function rawSeries() {
      const selected = samples.filter(sample =>
        sample.t >= state.start && sample.t <= state.end
      );

      return selectedSides().map(side => ({
        name: state.part === "pelvis"
          ? "골반 중심 / 골반선"
          : `${side === "left" ? "왼쪽" : "오른쪽"} ${parts[state.part].name}`,
        color: side === "left" ? "#50daf2" : "#f58cce",
        data: selected.map(sample => ({
          x: sample.t,
          y: sampleValue(
            sample,
            state.part,
            side,
            state.mode,
            state.threshold
          )
        }))
      }));
    }

    function findSample(time) {
      let low = 0;
      let high = samples.length - 1;

      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (samples[middle].t < time) low = middle + 1;
        else high = middle;
      }

      const candidates = [samples[low], samples[low - 1]].filter(Boolean);

      candidates.sort((a, b) =>
        Math.abs(a.t - time) - Math.abs(b.t - time)
      );

      const nearest = candidates[0];

      return nearest && Math.abs(nearest.t - time) <= 0.2
        ? nearest
        : null;
    }

    function selectedPointIds() {
      const ids = new Set();

      for (const side of selectedSides()) {
        if (state.part === "trunk") {
          (side === "left" ? [11, 23] : [12, 24])
            .forEach(id => ids.add(id));
        } else if (state.part === "pelvis") {
          ids.add(23);
          ids.add(24);
        } else if (state.mode === "angle" && jointTriples[state.part]) {
          jointTriples[state.part][side].forEach(id => ids.add(id));
        } else {
          ids.add(parts[state.part].points[side]);
        }
      }

      return ids;
    }

    function renderSkeleton() {
      const host = main.querySelector("#rx-skeleton");
      const label = main.querySelector("#rx-frame-label");
      if (!host || !label) return;

      const sample = findSample(state.time);

      label.textContent = `선택 시점 ${format(state.time, 2)}초`;

      if (!sample) {
        host.innerHTML = CM.empty(
          "이 시점에 가까운 저장 표본이 없습니다."
        );
        return;
      }

      const w = finite(record.width) && record.width > 0
        ? record.width : 1280;
      const h = finite(record.height) && record.height > 0
        ? record.height : 720;

      const scale = Math.max(w, h) / 800;
      const points = sample.points || [];
      const highlight = selectedPointIds();

      const lines = skeletonEdges.map(([a, b]) => {
        const pa = points[a];
        const pb = points[b];

        if (
          !pointValid(pa, state.threshold) ||
          !pointValid(pb, state.threshold)
        ) return "";

        const color = highlight.has(a) && highlight.has(b)
          ? "#f5d76e"
          : leftIds.has(a) ? "#50daf2" : "#f58cce";

        return `
          <line
            x1="${pa.x * w}" y1="${pa.y * h}"
            x2="${pb.x * w}" y2="${pb.y * h}"
            stroke="${color}"
            stroke-width="${3 * scale}"
            stroke-linecap="round"/>
        `;
      }).join("");

      const nodes = [...new Set(skeletonEdges.flat())].map(id => {
        const point = points[id];
        if (!pointValid(point, state.threshold)) return "";

        const selected = highlight.has(id);
        const color = selected
          ? "#f5d76e"
          : leftIds.has(id) ? "#50daf2" : "#f58cce";

        return `
          <circle cx="${point.x * w}" cy="${point.y * h}"
            r="${(selected ? 6 : 3) * scale}" fill="${color}"/>
        `;
      }).join("");

      const values = selectedSides().map(side => {
        const value = sampleValue(
          sample, state.part, side, state.mode, state.threshold
        );

        const name = state.part === "pelvis"
          ? "골반"
          : side === "left" ? "왼쪽" : "오른쪽";

        return `${name}: ${format(value)}${state.mode === "angle" ? "°" : "%"}`;
      }).join(" / ");

      host.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 ${w} ${h}"
          role="img" aria-label="저장된 기준점으로 표시한 스켈레톤"
          style="width:100%;max-height:350px;background:#06121b;
                 border-radius:12px">
          ${lines}${nodes}
        </svg>
        <p>${escape(values)}</p>
        <p class="muted">
          저장 표본 ${format(sample.t, 2)}초 ·
          선택 부위는 노란색 · 원본 영상이 아닌 기준점 재현입니다.
        </p>
      `;
    }

    function renderFeedback(series) {
      const unit = state.mode === "angle" ? "°" : "%";
      const modeLabel = {
        angle: "각도",
        x: "가로 위치",
        y: "세로 위치"
      }[state.mode];

      const observations = series.map(item => {
        const values = summary(item.data.map(point => point.y));

        if (!values.count) {
          return `${item.name}: 선택한 인식 기준을 만족하는 자료가 없습니다.`;
        }

        return (
          `${item.name} ${modeLabel}: ${format(values.min)}~` +
          `${format(values.max)}${unit}, 평균 ` +
          `${format(values.mean)}${unit}, 유효 표본 ${values.count}개.`
        );
      });

      currentObservation = observations.join("\n");

      const host = main.querySelector("#rx-feedback");
      if (!host) return;

      host.innerHTML = `
        <h2>측정 결과와 연구 근거 피드백</h2>

        <article class="panel" style="margin-bottom:12px">
          <h3>1. 현재 기록에서 관측한 내용</h3>
          ${observations.map(text => `<p>${escape(text)}</p>`).join("")}
          <p class="muted">
            선택 구간의 원본 유효값으로 계산합니다.
            보기용 평균선으로 점수나 통계를 바꾸지 않습니다.
          </p>
        </article>

        <article class="panel" style="margin-bottom:12px">
          <h3>2. 어떻게 해석할까?</h3>
          <p>${escape(research.interpretation)}</p>
          <p class="muted">
            현재 판정: 측정값 제공 / 개인별 정상 각도 판정은 보류.
            2D 내부각과 논문의 해부학적 굽힘각은 정의가 다를 수 있습니다.
          </p>
        </article>

        <article class="panel" style="margin-bottom:12px">
          <h3>3. 확인과 개선 연습</h3>
          <p>${escape(research.practice)}</p>
          <p class="muted">${escape(research.practiceLimit)}</p>
          <p class="muted">
            인식이 불안정한 구간은 먼저 원본 영상과 기준점부터 확인하세요.
            통증이 생기는 동작을 각도 목표에 맞추려고 반복하지 마세요.
          </p>
          <button id="rx-training" class="primary no-print">
            이 내용을 추가 훈련 계획으로
          </button>
        </article>

        <h3>4. 적용한 논문</h3>
        ${
          research.papers.length
            ? research.papers.map(paper => `
              <article class="panel" style="margin-bottom:10px">
                <strong>${escape(paper.author)} · ${paper.year}</strong>
                <p>
                  <a href="${paper.url}" target="_blank"
                    rel="noopener noreferrer">
                    ${escape(paper.title)}
                  </a>
                </p>
                <p class="muted">${escape(paper.population)}</p>
                <p>${escape(paper.finding)}</p>
                <p class="muted">${escape(paper.limit)}</p>
              </article>
            `).join("")
            : CM.empty("이 운동에 직접 적용할 연구 규칙은 아직 없습니다.")
        }

        <p class="muted">
          위 논문은 연구 초록을 확인해 요약했습니다.
          성인 연구를 청소년의 정상 각도나 부상 위험 기준으로
          그대로 적용하지 않습니다.
          기존 육각형은 앱의 참고 지표이며 논문으로 검증된 평가표가 아닙니다.
        </p>
      `;
    }

    function update() {
      const chart = main.querySelector("#rx-chart");
      if (!chart) return;

      const series = rawSeries();

      const displayed = series.map(item => ({
        ...item,
        name: item.name + (state.smooth ? " · 보기용 평균" : " · 원본"),
        data: state.smooth ? smoothLine(item.data) : item.data
      }));

      chart.innerHTML = CM.lineChart(displayed, {
        unit: state.mode === "angle" ? "°" : "%",
        maxGap: 0.8,
        xMin: state.start,
        xMax: state.end > state.start ? state.end : state.start + 0.1,
        currentTime: state.time
      });

      const note = main.querySelector("#rx-note");
      note.textContent = state.mode === "angle"
        ? (
            state.part === "pelvis"
              ? "골반선의 영상상 기울기입니다. 골반의 전후경사나 3D 회전각이 아닙니다."
              : state.part === "trunk"
                ? "수직선에 대한 몸통 기울기입니다."
                : "선택 관절의 영상상 2D 내부각입니다."
          )
        : (
            state.mode === "x"
              ? "영상 왼쪽이 0%, 오른쪽이 100%입니다. 몸의 좌우 이동량과는 구분하세요."
              : "영상 위쪽이 0%, 아래쪽이 100%입니다. 실제 높이(cm)가 아닙니다."
          );

      renderSkeleton();
      renderFeedback(series);
    }

    function mount() {
      const content = main.querySelector("#rp-content");
      if (!content) return;

      if (unbindSeek) {
        unbindSeek();
        unbindSeek = null;
      }

      content.querySelector("#rx-explorer")?.remove();
      content.querySelector("#rx-feedback")?.remove();

      // 이전 자동 문구를 연구 근거 피드백으로 대체합니다.
      for (const section of [...content.children]) {
        const title = section.querySelector("h2")?.textContent?.trim();

        if (
          title === "자동 코치 피드백" ||
          title === "다음 훈련을 위한 제안"
        ) {
          section.remove();
        }
      }

      content.insertAdjacentHTML("afterbegin", `
        <section id="rx-explorer" class="panel report-section"
          style="margin-bottom:18px">
          <h2>원하는 부위의 스켈레톤 변화</h2>

          <div class="grid g3 no-print">
            <label>
              부위
              <select id="rx-part">
                ${Object.entries(parts).map(([key, part]) => `
                  <option value="${key}"
                    ${key === state.part ? "selected" : ""}>
                    ${part.name}
                  </option>
                `).join("")}
              </select>
            </label>

            <label>
              방향
              <select id="rx-side">
                <option value="both">좌우 모두</option>
                <option value="left">왼쪽만</option>
                <option value="right">오른쪽만</option>
              </select>
            </label>

            <label>
              그래프 내용
              <select id="rx-mode">
                <option value="angle">각도 변화</option>
                <option value="x">가로 위치 변화</option>
                <option value="y">세로 위치 변화</option>
              </select>
            </label>
          </div>

          <div class="grid g3 no-print" style="margin-top:12px">
            <label>
              시작 초
              <input id="rx-start" type="number" step="0.01"
                value="${state.start}">
            </label>
            <label>
              종료 초
              <input id="rx-end" type="number" step="0.01"
                value="${state.end}">
            </label>
            <label>
              기준점 인식 필터
              <select id="rx-confidence">
                <option value="0.55">기본 · 0.55 이상</option>
                <option value="0.75">엄격 · 0.75 이상</option>
                <option value="0.9">매우 엄격 · 0.90 이상</option>
              </select>
            </label>
          </div>

          <div class="row no-print"
            style="margin:14px 0;gap:12px;flex-wrap:wrap">
            <label>
              <input id="rx-smooth" type="checkbox"
                ${state.smooth ? "checked" : ""}>
              보기용 평균선
            </label>
            <button id="rx-full">전체 구간</button>
          </div>

          <p class="muted">
            인식 필터 숫자는 모델의 기준점 가시성 값입니다.
            정확도 75% 같은 의미가 아닙니다.
            수동 수정점은 필터와 별도로 유지합니다.
          </p>

          <div id="rx-chart" class="chart"></div>
          <p id="rx-note" class="muted"></p>

          <h3 id="rx-frame-label"></h3>
          <input id="rx-time" type="range"
            min="${state.start}"
            max="${Math.max(state.start + 0.01, state.end)}"
            value="${state.time}" step="0.01"
            aria-label="스켈레톤 확인 시점"
            class="no-print" style="width:100%">
          <div id="rx-skeleton"></div>
        </section>
      `);

      content.insertAdjacentHTML("beforeend", `
        <section id="rx-feedback" class="panel report-section"
          style="margin-bottom:18px"></section>
      `);

      main.querySelector("#rx-side").value = state.side;
      main.querySelector("#rx-mode").value = state.mode;
      main.querySelector("#rx-confidence").value = String(state.threshold);

      unbindSeek = CM.bindChartSeek(
        main.querySelector("#rx-chart"),
        time => {
          state.time = Math.max(state.start, Math.min(state.end, time));
          main.querySelector("#rx-time").value = state.time;
          update();
        }
      );

      update();
    }

    main.addEventListener("change", event => {
      const id = event.target.id;

      // 기존 리포트의 관절 변경으로 내용이 다시 생성된 경우
      if (id === "rp-joint" || id === "rp-side") {
        mount();
        return;
      }

      if (id === "rx-part") {
        state.part = event.target.value;

        if (!parts[state.part].angle && state.mode === "angle") {
          state.mode = "x";
          main.querySelector("#rx-mode").value = "x";
        }
      } else if (id === "rx-side") {
        state.side = event.target.value;
      } else if (id === "rx-mode") {
        state.mode = event.target.value;

        if (!parts[state.part].angle && state.mode === "angle") {
          state.mode = "x";
          event.target.value = "x";
          CM.toast("손목은 현재 위치 변화를 제공합니다.");
        }
      } else if (id === "rx-confidence") {
        state.threshold = Number(event.target.value);
      } else if (id === "rx-smooth") {
        state.smooth = event.target.checked;
      } else if (id === "rx-start" || id === "rx-end") {
        const start = Number(main.querySelector("#rx-start").value);
        const end = Number(main.querySelector("#rx-end").value);

        if (
          !finite(start) || !finite(end) ||
          start < samples[0].t ||
          end > samples[samples.length - 1].t ||
          end <= start
        ) {
          CM.toast("저장된 기록 안에서 올바른 시작·종료 시간을 선택하세요.");
          main.querySelector("#rx-start").value = state.start;
          main.querySelector("#rx-end").value = state.end;
          return;
        }

        state.start = start;
        state.end = end;
        state.time = Math.max(start, Math.min(end, state.time));

        const slider = main.querySelector("#rx-time");
        slider.min = start;
        slider.max = end;
        slider.value = state.time;
      } else {
        return;
      }

      update();
    }, { signal });

    main.addEventListener("input", event => {
      if (event.target.id !== "rx-time") return;

      state.time = Number(event.target.value);
      renderSkeleton();
    }, { signal });

    main.addEventListener("change", event => {
      if (event.target.id === "rx-time") update();
    }, { signal });

    main.addEventListener("click", async event => {
      if (event.target.closest("#rx-full")) {
        state.start = samples[0].t;
        state.end = samples[samples.length - 1].t;
        state.time = state.start;
        mount();
        return;
      }

      if (!event.target.closest("#rx-training")) return;

      // 기존 리포트의 저장 처리는 이동 시 기존 guard가 확인합니다.
      // 메모를 자동으로 덮어쓰거나 저장 완료를 가정하지 않습니다.
      const coachPriority =
        main.querySelector("#rp-priorities")?.value?.trim() || "";
      const coachGoal =
        main.querySelector("#rp-goal")?.value?.trim() || "";

      CM.selectedAthlete = record.athleteId || "";

      CM.trainingDraft = {
        athleteId: record.athleteId || "",
        athleteName: record.athleteName || "게스트",
        sourceRecordId: record.id,
        reason: [
          currentObservation,
          research.interpretation,
          coachPriority && `코치 메모: ${coachPriority}`
        ].filter(Boolean).join("\n\n"),
        goal: [
          research.practice,
          research.practiceLimit,
          coachGoal && `코치 목표: ${coachGoal}`,
          research.papers.map(paper =>
            `${paper.author} (${paper.year}) ${paper.url}`
          ).join("\n")
        ].filter(Boolean).join("\n\n")
      };

      location.hash = "training";
    }, { signal });

    CM.reportsCleanup = () => {
      controller.abort();

      if (unbindSeek) {
        unbindSeek();
        unbindSeek = null;
      }

      if (typeof previousCleanup === "function") {
        previousCleanup();
      }

      CM.reportsCleanup = null;
    };

    mount();
  };
})();