/* =========================================================
   실버스타 스포츠 과학원 · CODEON MOTION
   storage.js

   - IndexedDB 기기 내 저장
   - 선수 / 분석 기록 / 훈련 / 영상 / 설정 관리
   - JSON 백업 및 복원
   - 공통 ID / HTML 처리 / 파일 다운로드

   주의:
   브라우저 데이터를 삭제하면 저장 기록도 삭제됩니다.
   JSON 백업에는 원본 동영상이 포함되지 않습니다.
   ========================================================= */

"use strict";

window.CM = window.CM || {};

/* ---------------------------------------------------------
   1. 공통 도구
   --------------------------------------------------------- */

CM.uid = function () {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 12)
  );
};

/**
 * 사용자 입력을 HTML에 넣을 때 사용합니다.
 */
CM.escape = function (value) {
  const entities = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  return String(value ?? "").replace(
    /[&<>"']/g,
    function (character) {
      return entities[character];
    }
  );
};

/**
 * 문자열 또는 Blob을 파일로 내려받습니다.
 */
CM.download = function (
  filename,
  content,
  mimeType = "application/json;charset=utf-8"
) {
  const blob =
    content instanceof Blob
      ? content
      : new Blob([content], { type: mimeType });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 30000);
};

/**
 * app.js의 알림 기능이 준비되었을 때 안내합니다.
 */
CM.storageNotice = function (message) {
  if (typeof CM.toast === "function") {
    CM.toast(message);
  } else {
    console.info(message);
  }
};

/* ---------------------------------------------------------
   2. 데이터베이스 설정
   --------------------------------------------------------- */

CM.db = {
  name: "silverstar-codeon-v1",
  version: 1,

  handle: null,
  opening: null,

  stores: [
    "athletes",
    "records",
    "training",
    "media",
    "settings"
  ],

  backupStores: [
    "athletes",
    "records",
    "training",
    "settings"
  ],

  /**
   * 데이터베이스를 엽니다.
   * 여러 곳에서 동시에 호출해도 같은 연결을 사용합니다.
   */
  async open() {
    if (this.handle) {
      return this.handle;
    }

    if (this.opening) {
      return this.opening;
    }

    if (!window.indexedDB) {
      throw new Error(
        "현재 브라우저에서 IndexedDB 저장을 사용할 수 없습니다."
      );
    }

    this.opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(
        this.name,
        this.version
      );

      request.onupgradeneeded = () => {
        const database = request.result;

        for (const storeName of this.stores) {
          if (
            !database.objectStoreNames.contains(storeName)
          ) {
            database.createObjectStore(storeName, {
              keyPath: "id"
            });
          }
        }
      };

      request.onsuccess = () => {
        const database = request.result;

        database.onversionchange = () => {
          database.close();

          if (this.handle === database) {
            this.handle = null;
          }

          CM.storageNotice(
            "저장 구조가 변경되었습니다. 화면을 새로고침해 주세요."
          );
        };

        this.handle = database;
        resolve(database);
      };

      request.onerror = () => {
        reject(
          request.error ||
          new Error("데이터베이스를 열지 못했습니다.")
        );
      };

      request.onblocked = () => {
        CM.storageNotice(
          "다른 탭에서 같은 프로그램이 열려 있습니다. 해당 탭을 닫고 다시 시도해 주세요."
        );
      };
    });

    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  },

  /**
   * 저장소 이름을 확인합니다.
   */
  validateStore(storeName) {
    if (!this.stores.includes(storeName)) {
      throw new Error(
        "알 수 없는 저장소입니다: " + storeName
      );
    }
  },

  /**
   * 단일 IndexedDB 요청을 실행합니다.
   * 요청 성공이 아니라 트랜잭션 완료 시점을 기다립니다.
   */
  async run(storeName, mode, operation) {
    this.validateStore(storeName);

    const database = await this.open();

    return new Promise((resolve, reject) => {
      let result;
      let operationError = null;

      const transaction = database.transaction(
        storeName,
        mode
      );

      transaction.oncomplete = () => {
        resolve(result);
      };

      transaction.onerror = () => {
        reject(
          operationError ||
          transaction.error ||
          new Error("데이터 처리 중 오류가 발생했습니다.")
        );
      };

      transaction.onabort = () => {
        reject(
          operationError ||
          transaction.error ||
          new Error("데이터 처리가 취소되었습니다.")
        );
      };

      try {
        const store =
          transaction.objectStore(storeName);

        const request = operation(store);

        request.onsuccess = () => {
          result = request.result;
        };

        request.onerror = () => {
          operationError = request.error;
        };
      } catch (error) {
        operationError = error;

        try {
          transaction.abort();
        } catch (_) {
          reject(error);
        }
      }
    });
  },

  /* -------------------------------------------------------
     3. 기본 읽기 / 쓰기
     ------------------------------------------------------- */

  all(storeName) {
    return this.run(
      storeName,
      "readonly",
      store => store.getAll()
    );
  },

  get(storeName, id) {
    return this.run(
      storeName,
      "readonly",
      store => store.get(id)
    );
  },

  put(storeName, value) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.id !== "string" ||
      !value.id.trim()
    ) {
      return Promise.reject(
        new Error("저장할 데이터에 유효한 ID가 필요합니다.")
      );
    }

    return this.run(
      storeName,
      "readwrite",
      store => store.put(value)
    );
  },

  remove(storeName, id) {
    return this.run(
      storeName,
      "readwrite",
      store => store.delete(id)
    );
  },

  count(storeName) {
    return this.run(
      storeName,
      "readonly",
      store => store.count()
    );
  },

  /**
   * 같은 저장소의 여러 항목을 한 번에 저장합니다.
   * 하나라도 실패하면 이 묶음 전체가 취소됩니다.
   */
  async putMany(storeName, items) {
    this.validateStore(storeName);

    if (!Array.isArray(items)) {
      throw new Error("저장할 항목은 배열이어야 합니다.");
    }

    for (const item of items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id.trim()
      ) {
        throw new Error(
          "모든 저장 항목에 유효한 ID가 필요합니다."
        );
      }
    }

    const database = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = database.transaction(
        storeName,
        "readwrite"
      );

      let operationError = null;

      transaction.oncomplete = () => {
        resolve(items.length);
      };

      transaction.onerror = () => {
        reject(
          operationError ||
          transaction.error ||
          new Error("일괄 저장에 실패했습니다.")
        );
      };

      transaction.onabort = () => {
        reject(
          operationError ||
          transaction.error ||
          new Error("일괄 저장이 취소되었습니다.")
        );
      };

      try {
        const store =
          transaction.objectStore(storeName);

        for (const item of items) {
          store.put(item);
        }
      } catch (error) {
        operationError = error;
        transaction.abort();
      }
    });
  },

  /* -------------------------------------------------------
     4. 일관된 백업용 데이터 읽기
     ------------------------------------------------------- */

  async readBackupSnapshot() {
    const database = await this.open();
    const names = this.backupStores;

    return new Promise((resolve, reject) => {
      const snapshot = {};

      const transaction = database.transaction(
        names,
        "readonly"
      );

      transaction.oncomplete = () => {
        resolve(snapshot);
      };

      transaction.onerror = () => {
        reject(
          transaction.error ||
          new Error("백업 데이터를 읽지 못했습니다.")
        );
      };

      transaction.onabort = () => {
        reject(
          transaction.error ||
          new Error("백업 읽기가 취소되었습니다.")
        );
      };

      for (const name of names) {
        const request =
          transaction.objectStore(name).getAll();

        request.onsuccess = () => {
          snapshot[name] = request.result;
        };
      }
    });
  },

  /* -------------------------------------------------------
     5. JSON 백업
     ------------------------------------------------------- */

  async backup() {
    const snapshot = await this.readBackupSnapshot();

    const backupData = {
      schema: 1,
      application: "CODEON MOTION",
      exportedAt: new Date().toISOString(),

      mediaIncluded: false,

      notice:
        "원본 동영상은 포함되지 않습니다. 원본 파일을 별도로 보관하세요.",

      ...snapshot
    };

    const now = new Date();

    const dateLabel = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");

    CM.download(
      "codeon-backup-" + dateLabel + ".json",
      JSON.stringify(backupData, null, 2)
    );

    CM.storageNotice(
      "기록 백업을 내려받았습니다. 원본 동영상은 별도로 보관해 주세요."
    );

    return backupData;
  },

  /* -------------------------------------------------------
     6. 백업 검사
     ------------------------------------------------------- */

  validateBackup(data) {
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      throw new Error("올바른 백업 파일이 아닙니다.");
    }

    if (data.schema !== 1) {
      throw new Error(
        "지원하지 않는 백업 버전입니다."
      );
    }

    for (const name of this.backupStores) {
      const items = data[name];

      if (!Array.isArray(items)) {
        throw new Error(
          "백업에서 " + name + " 목록을 찾을 수 없습니다."
        );
      }

      const ids = new Set();

      for (const item of items) {
        if (
          !item ||
          typeof item !== "object" ||
          Array.isArray(item) ||
          typeof item.id !== "string" ||
          !item.id.trim()
        ) {
          throw new Error(
            name + "에 올바르지 않은 항목이 있습니다."
          );
        }

        if (ids.has(item.id)) {
          throw new Error(
            name + "에 중복된 ID가 있습니다."
          );
        }

        ids.add(item.id);

        if (
          name === "athletes" &&
          (
            typeof item.name !== "string" ||
            !item.name.trim()
          )
        ) {
          throw new Error(
            "선수 이름이 없는 백업 항목이 있습니다."
          );
        }

        if (name === "records") {
          if (
            !Array.isArray(item.samples) ||
            !item.exercise
          ) {
            throw new Error(
              "분석 기록의 운동 또는 측정 데이터가 올바르지 않습니다."
            );
          }

          for (const sample of item.samples) {
            if (
              !sample ||
              typeof sample !== "object" ||
              Array.isArray(sample)
            ) {
              throw new Error(
                "분석 기록에 올바르지 않은 측정 항목이 있습니다."
              );
            }
          }
        }
      }
    }

    return true;
  },

  /* -------------------------------------------------------
     7. 백업 복원
     같은 ID는 교체하고, 다른 ID는 추가합니다.
     원본 영상 저장소는 변경하지 않습니다.
     ------------------------------------------------------- */

  async restore(file) {
    if (!(file instanceof Blob)) {
      throw new Error("복원할 파일을 선택해 주세요.");
    }

    const maxSize = 100 * 1024 * 1024;

    if (file.size > maxSize) {
      throw new Error(
        "100MB 이하의 JSON 백업 파일을 선택해 주세요."
      );
    }

    let data;

    try {
      data = JSON.parse(await file.text());
    } catch (_) {
      throw new Error(
        "JSON 파일을 읽지 못했습니다. 백업 파일을 확인해 주세요."
      );
    }

    this.validateBackup(data);

    const database = await this.open();
    const names = this.backupStores;

    const restoredCount = await new Promise(
      (resolve, reject) => {
        const transaction = database.transaction(
          names,
          "readwrite"
        );

        let count = 0;
        let operationError = null;

        transaction.oncomplete = () => {
          resolve(count);
        };

        transaction.onerror = () => {
          reject(
            operationError ||
            transaction.error ||
            new Error("복원 중 오류가 발생했습니다.")
          );
        };

        transaction.onabort = () => {
          reject(
            operationError ||
            transaction.error ||
            new Error(
              "복원이 취소되었습니다. 기존 데이터는 유지됩니다."
            )
          );
        };

        try {
          for (const name of names) {
            const store =
              transaction.objectStore(name);

            for (const item of data[name]) {
              store.put(item);
              count += 1;
            }
          }
        } catch (error) {
          operationError = error;
          transaction.abort();
        }
      }
    );

    CM.storageNotice(
      restoredCount +
      "개 항목을 복원했습니다. 같은 ID의 기록은 백업 내용으로 교체되었습니다."
    );

    return {
      count: restoredCount,
      mediaIncluded: false
    };
  }
};