(function() {
  var STORAGE_KEY = "classManager_v1";
  var LEGACY_POWERHOUSE_KEY = "classPowerhouse_v9.4_final";
  var LEGACY_BLACKBOARD_HW_KEY = "bb_hw2";
  var LEGACY_BLACKBOARD_OVERRIDES_KEY = "bb_char_overrides";
  var LEGACY_SEATING_KEY = "seatingChartState_v10.9";
  var LEGACY_GROUPING_KEY = "groupGeneratorNames_v7_4";
  var LEGACY_KEYS = [
    LEGACY_POWERHOUSE_KEY,
    LEGACY_BLACKBOARD_HW_KEY,
    LEGACY_BLACKBOARD_OVERRIDES_KEY,
    LEGACY_SEATING_KEY,
    LEGACY_GROUPING_KEY
  ];
  var BLACKBOARD_KEEP_DAYS = 90;
  var EXAM_HISTORY_LIMIT = 50;
  var STORAGE_SOFT_LIMIT_BYTES = 5 * 1024 * 1024;

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      console.warn("Cannot read localStorage key:", key, err);
      return fallback;
    }
  }

  function isQuotaError(err) {
    return err && (
      err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22 ||
      err.code === 1014
    );
  }

  function purgeLegacyStorageKeys() {
    LEGACY_KEYS.forEach(function(key) {
      try { localStorage.removeItem(key); }
      catch (err) { console.warn("Cannot remove legacy localStorage key:", key, err); }
    });
  }

  function emergencyCompactData(data) {
    var compacted = compactData(data);
    if (!compacted || !Array.isArray(compacted.classes)) return compacted;
    compacted.legacyImports = { blackboard: null, seating: null, quickGrouping: null };
    compacted.classes.forEach(function(cls) {
      if (cls.examTimer && Array.isArray(cls.examTimer.history)) {
        cls.examTimer.history = cls.examTimer.history.slice(0, 20);
      }
      if (cls.quickGrouping) cls.quickGrouping.lastGroups = [];
    });
    return compacted;
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      if (key === STORAGE_KEY && isQuotaError(err)) {
        try {
          localStorage.setItem(key, JSON.stringify(compactData(value)));
          return;
        } catch (secondErr) {
          if (isQuotaError(secondErr)) {
            purgeLegacyStorageKeys();
            localStorage.setItem(key, JSON.stringify(emergencyCompactData(value)));
            return;
          }
          throw secondErr;
        }
      }
      throw err;
    }
  }

  function makeId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getTodayStr() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
  }

  function normalizeStudent(student, index) {
    var id = student && student.id != null ? String(student.id) : String(index + 1);
    var name = student && student.name ? String(student.name) : id + "號";
    return {
      id: id,
      name: name,
      score: Number(student && student.score) || 0,
      group: student && student.group != null ? student.group : null,
      grade: student && student.grade != null ? student.grade : null,
      tags: Array.isArray(student && student.tags) ? student.tags.slice() : []
    };
  }

  function normalizeGroups(groups, groupCount) {
    var count = Math.max(1, Number(groupCount) || 4);
    var list = Array.isArray(groups) ? groups : [];
    return Array.from({ length: count }, function(_, index) {
      var existing = list.find(function(group) { return Number(group.id) === index + 1; }) || {};
      return { id: index + 1, score: Number(existing.score) || 0 };
    });
  }

  function normalizeClass(cls, index) {
    var students = Array.isArray(cls && cls.students) ? cls.students.map(normalizeStudent) : [];
    var groupCount = Math.max(1, Number(cls && cls.groupCount) || 4);
    return {
      id: cls && cls.id ? String(cls.id) : makeId("C"),
      name: cls && cls.name ? String(cls.name) : "未命名班級 " + (index + 1),
      students: students,
      homeworks: Array.isArray(cls && cls.homeworks) ? cls.homeworks : [],
      groups: normalizeGroups(cls && cls.groups, groupCount),
      groupCount: groupCount,
      blackboard: {
        homeworkByDate: Object.assign({}, cls && cls.blackboard && cls.blackboard.homeworkByDate),
        charOverrides: Object.assign({}, cls && cls.blackboard && cls.blackboard.charOverrides)
      },
      seating: Object.assign({
        currentStep: 1,
        seatingMode: "individual",
        groups: [],
        rules: [],
        layout: { individualStyle: "traditional", groupStyle: "pod", rows: 5, cols: 6 },
        seatMap: {},
        customTags: ["需要協助", "活潑"],
        tagColors: ["#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#5f27cd", "#ff9ff3", "#00d2d3"]
      }, cls && cls.seating),
      quickGrouping: Object.assign({
        names: [],
        groupCount: groupCount,
        lastGroups: []
      }, cls && cls.quickGrouping),
      examTimer: Object.assign({
        mode: "exam",
        expectedCount: students.length,
        actualCount: students.length,
        note: "",
        timeOnly: false,
        schedule: [],
        history: []
      }, cls && cls.examTimer)
    };
  }

  function compactHomeworkByDate(homeworkByDate) {
    var cutoff = new Date(getTodayStr() + "T00:00:00");
    cutoff.setDate(cutoff.getDate() - BLACKBOARD_KEEP_DAYS + 1);
    var cleaned = {};
    Object.keys(homeworkByDate || {}).forEach(function(dateKey) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      var day = new Date(dateKey + "T00:00:00");
      if (day >= cutoff) cleaned[dateKey] = homeworkByDate[dateKey];
    });
    return cleaned;
  }

  function compactClass(cls) {
    if (cls.blackboard && cls.blackboard.homeworkByDate) {
      cls.blackboard.homeworkByDate = compactHomeworkByDate(cls.blackboard.homeworkByDate);
    }

    if (cls.examTimer) {
      var history = Array.isArray(cls.examTimer.history) ? cls.examTimer.history.slice() : [];
      history.sort(function(a, b) {
        return new Date(b.startedAt || 0) - new Date(a.startedAt || 0);
      });
      cls.examTimer.history = history.slice(0, EXAM_HISTORY_LIMIT);
    }
    return cls;
  }

  function compactData(data) {
    if (!data || !Array.isArray(data.classes)) return data;
    data.classes.forEach(compactClass);
    if (data.legacyImports && data.legacyImports.blackboard && data.legacyImports.blackboard.homeworkByDate) {
      data.legacyImports.blackboard.homeworkByDate = compactHomeworkByDate(data.legacyImports.blackboard.homeworkByDate);
    }
    return data;
  }

  function normalizeData(data) {
    var classes = Array.isArray(data && data.classes) ? data.classes.map(normalizeClass) : [];
    var currentClassId = data && data.currentClassId && classes.some(function(cls) { return cls.id === data.currentClassId; })
      ? data.currentClassId
      : (classes[0] ? classes[0].id : null);
    return compactData({
      version: 1,
      migratedAt: data && data.migratedAt ? data.migratedAt : new Date().toISOString(),
      currentClassId: currentClassId,
      classes: classes,
      legacyImports: Object.assign({
        blackboard: null,
        seating: null,
        quickGrouping: null
      }, data && data.legacyImports)
    });
  }

  function studentNames(students) {
    return (students || []).map(function(student) {
      return String(student.name || student).trim();
    }).filter(Boolean).sort();
  }

  function findMatchingClass(data, names) {
    var source = studentNames(names.map(function(name) { return { name: name }; }));
    if (!source.length) return null;
    var best = null;
    var bestScore = 0;
    data.classes.forEach(function(cls) {
      var target = studentNames(cls.students);
      if (!target.length) return;
      var targetSet = new Set(target);
      var overlap = source.filter(function(name) { return targetSet.has(name); }).length;
      var score = overlap / Math.max(source.length, target.length);
      if (score > bestScore) {
        bestScore = score;
        best = cls;
      }
    });
    return bestScore >= 0.7 ? best : null;
  }

  function migrateLegacy() {
    var legacy = readJSON(LEGACY_POWERHOUSE_KEY, null);
    var data = normalizeData({ classes: legacy && Array.isArray(legacy.classes) ? legacy.classes : [] });

    var hw = readJSON(LEGACY_BLACKBOARD_HW_KEY, {});
    var overrides = readJSON(LEGACY_BLACKBOARD_OVERRIDES_KEY, {});
    var hasBlackboard = Object.keys(hw || {}).length > 0 || Object.keys(overrides || {}).length > 0;
    if (hasBlackboard) {
      if (data.classes.length === 1) {
        data.classes[0].blackboard.homeworkByDate = Object.assign({}, hw);
        data.classes[0].blackboard.charOverrides = Object.assign({}, overrides);
      } else {
        data.legacyImports.blackboard = { homeworkByDate: hw || {}, charOverrides: overrides || {} };
      }
    }

    var seating = readJSON(LEGACY_SEATING_KEY, null);
    if (seating && Array.isArray(seating.students) && seating.students.length) {
      var seatingClass = findMatchingClass(data, seating.students.map(function(student) { return student.name; }));
      if (seatingClass) seatingClass.seating = Object.assign({}, seatingClass.seating, seating);
      else data.legacyImports.seating = seating;
    }

    var groupingNames = readJSON(LEGACY_GROUPING_KEY, null);
    if (Array.isArray(groupingNames) && groupingNames.length) {
      var groupingClass = findMatchingClass(data, groupingNames);
      if (groupingClass) {
        groupingClass.quickGrouping.names = groupingNames.slice();
      } else {
        data.legacyImports.quickGrouping = { names: groupingNames.slice() };
      }
    }

    data.currentClassId = data.classes[0] ? data.classes[0].id : null;
    try { writeJSON(STORAGE_KEY, data); }
    catch (err) { console.warn("Cannot persist migrated class manager data:", err); }
    return data;
  }

  function load() {
    var stored = readJSON(STORAGE_KEY, null);
    if (!stored) return migrateLegacy();
    var normalized = normalizeData(stored);
    try { writeJSON(STORAGE_KEY, normalized); }
    catch (err) { console.warn("Cannot persist normalized class manager data:", err); }
    return normalized;
  }

  function save(data) {
    var normalized = normalizeData(data);
    writeJSON(STORAGE_KEY, normalized);
    return normalized;
  }

  function cleanup() {
    var normalized = normalizeData(readJSON(STORAGE_KEY, { classes: [] }));
    purgeLegacyStorageKeys();
    writeJSON(STORAGE_KEY, normalized);
    return normalized;
  }

  function emergencyCleanup() {
    var normalized = emergencyCompactData(normalizeData(readJSON(STORAGE_KEY, { classes: [] })));
    purgeLegacyStorageKeys();
    writeJSON(STORAGE_KEY, normalized);
    return normalized;
  }

  function getStorageInfo() {
    var raw = "";
    try { raw = localStorage.getItem(STORAGE_KEY) || ""; }
    catch (err) { raw = ""; }
    var bytes = 0;
    try { bytes = new Blob([raw]).size; }
    catch (err) { bytes = raw.length; }
    return {
      bytes: bytes,
      kb: Math.round(bytes / 1024),
      mb: Math.round(bytes / 1024 / 1024 * 100) / 100,
      percent: Math.min(100, Math.round(bytes / STORAGE_SOFT_LIMIT_BYTES * 100)),
      softLimitBytes: STORAGE_SOFT_LIMIT_BYTES,
      blackboardKeepDays: BLACKBOARD_KEEP_DAYS,
      examHistoryLimit: EXAM_HISTORY_LIMIT
    };
  }

  function parseStudents(input) {
    var text = String(input || "").trim();
    if (!text) return [];
    if (!text.includes("\n") && !isNaN(parseInt(text, 10))) {
      return Array.from({ length: parseInt(text, 10) }, function(_, index) {
        return { id: String(index + 1), name: (index + 1) + "號" };
      });
    }
    return text.split(/\n+/).map(function(line, index) {
      var trimmed = line.trim();
      if (!trimmed) return null;
      var parts = trimmed.split(/\s+/);
      if (parts.length === 1) return { id: String(index + 1), name: parts[0] };
      return { id: parts[0], name: parts.slice(1).join(" ") || parts[0] + "號" };
    }).filter(Boolean);
  }

  function createClass(name, studentInput) {
    var data = load();
    var students = parseStudents(studentInput).map(normalizeStudent);
    var groupCount = 4;
    var cls = normalizeClass({
      id: makeId("C"),
      name: name,
      students: students,
      homeworks: [],
      groupCount: groupCount,
      groups: normalizeGroups([], groupCount),
      quickGrouping: { names: students.map(function(student) { return student.name; }), groupCount: groupCount, lastGroups: [] },
      examTimer: { mode: "exam", expectedCount: students.length, actualCount: students.length, note: "", timeOnly: false, schedule: [], history: [] }
    }, data.classes.length);
    data.classes.push(cls);
    data.currentClassId = cls.id;
    save(data);
    return cls;
  }

  function updateClass(classId, patch) {
    var data = load();
    var cls = data.classes.find(function(item) { return item.id === classId; });
    if (!cls) return null;
    Object.assign(cls, patch || {});
    if (patch && patch.students) cls.students = patch.students.map(normalizeStudent);
    save(data);
    return cls;
  }

  function deleteClass(classId) {
    var data = load();
    data.classes = data.classes.filter(function(cls) { return cls.id !== classId; });
    if (data.currentClassId === classId) data.currentClassId = data.classes[0] ? data.classes[0].id : null;
    save(data);
  }

  function getUrlClassId() {
    return new URLSearchParams(location.search).get("classId");
  }

  function setCurrentClassId(classId) {
    var data = load();
    if (data.classes.some(function(cls) { return cls.id === classId; })) {
      data.currentClassId = classId;
      save(data);
    }
  }

  function getActiveClass() {
    var data = load();
    var classId = getUrlClassId() || data.currentClassId;
    var cls = data.classes.find(function(item) { return item.id === classId; }) || data.classes[0] || null;
    if (cls) setCurrentClassId(cls.id);
    return cls;
  }

  function upsertActiveClass(cls) {
    var data = load();
    var index = data.classes.findIndex(function(item) { return item.id === cls.id; });
    if (index >= 0) data.classes[index] = normalizeClass(cls, index);
    else data.classes.push(normalizeClass(cls, data.classes.length));
    data.currentClassId = cls.id;
    save(data);
  }

  window.ClassManager = {
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    save: save,
    createClass: createClass,
    updateClass: updateClass,
    deleteClass: deleteClass,
    parseStudents: parseStudents,
    getTodayStr: getTodayStr,
    getUrlClassId: getUrlClassId,
    setCurrentClassId: setCurrentClassId,
    getActiveClass: getActiveClass,
    upsertActiveClass: upsertActiveClass,
    cleanup: cleanup,
    emergencyCleanup: emergencyCleanup,
    getStorageInfo: getStorageInfo
  };
})();
