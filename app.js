(function() {
  var h = React.createElement;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useRef = React.useRef;
  var useMemo = React.useMemo;

  /* ─── Constants & Helpers ─── */
  var DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
  var CN_NUM = [
    "", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二",
    "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
    "二十一", "二十二", "二十三", "二十四", "二十五", "二十六", "二十七", "二十八", "二十九", "三十", "三十一"
  ];
  var DEFAULT_HOMEWORK = "一、國語第八課生字\n二、數學習作\n三、明天穿運動服";
  var DEFAULT_TODO = "一、課堂重點整理\n二、小組討論任務\n三、下課前完成學習單";
  var TODO_SESSION_PREFIX = "classroomTodoBlackboard_v1";
  var STATUS_ORDER = ["pending", "submitted", "needs_correction", "completed"];
  var STATUS_TEXT = { pending: "未繳交", submitted: "已繳交", needs_correction: "待訂正", completed: "已完成" };

  var getTodayStr = function() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split("T")[0];
  };

  var getHomeworkCreatedValue = function(homework, fallbackIndex) {
    if (homework && homework.createdAt) {
      var created = new Date(homework.createdAt).getTime();
      if (!isNaN(created)) return created;
    }
    var idMatch = homework && String(homework.id || "").match(/^H(\d{8,})/);
    if (idMatch) return Number(idMatch[1]);
    if (homework && homework.date) {
      var dated = new Date(homework.date).getTime();
      if (!isNaN(dated)) return dated;
    }
    return Number.MAX_SAFE_INTEGER - (Number(fallbackIndex) || 0);
  };

  var CLOUD_USAGE_KEY = "classManager_cloudSaveUsage_v1";
  var CLOUD_DRAFT_KEY = "classManager_firebaseDraft_v1";
  var CLOUD_DAILY_LIMIT = 3;
  var AI_TOOLS_URL = "https://chunsheng612.github.io/FunFun.AI-Website/";

  var getCloudSaveUsage = function() {
    var today = getTodayStr();
    try {
      var parsed = JSON.parse(localStorage.getItem(CLOUD_USAGE_KEY) || "{}");
      if (parsed.date !== today) parsed = { date: today, count: 0 };
      return Object.assign({ date: today, count: 0, lastSavedAt: null, compressedSize: 0, originalSize: 0, status: "尚未儲存" }, parsed);
    } catch (err) {
      return { date: today, count: 0, lastSavedAt: null, compressedSize: 0, originalSize: 0, status: "尚未儲存" };
    }
  };

  var saveCloudSaveUsage = function(nextUsage) {
    try { localStorage.setItem(CLOUD_USAGE_KEY, JSON.stringify(nextUsage)); }
    catch (err) { console.warn("Cannot save cloud usage", err); }
  };

  var bytesToBase64 = function(bytes) {
    var binary = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  var base64ToBytes = function(base64) {
    var binary = atob(String(base64 || ""));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };

  var getCloudDraftMeta = function() {
    try {
      var draft = JSON.parse(localStorage.getItem(CLOUD_DRAFT_KEY) || "null");
      if (!draft || !draft.payload) return null;
      return {
        savedAt: draft.savedAt || draft.payload.createdAt || null,
        compressedSize: Number(draft.payload.compressedSize) || 0,
        originalSize: Number(draft.payload.originalSize) || 0,
        algorithm: draft.payload.algorithm || "unknown"
      };
    } catch (err) {
      return null;
    }
  };

  var compressTextForCloud = async function(text) {
    var encoded = new TextEncoder().encode(text);
    if (window.CompressionStream) {
      var stream = new Blob([encoded]).stream().pipeThrough(new window.CompressionStream("gzip"));
      var compressedBuffer = await new Response(stream).arrayBuffer();
      var compressedBytes = new Uint8Array(compressedBuffer);
      return {
        algorithm: "gzip-base64",
        data: bytesToBase64(compressedBytes),
        originalSize: encoded.length,
        compressedSize: compressedBytes.length
      };
    }
    return {
      algorithm: "plain-base64",
      data: bytesToBase64(encoded),
      originalSize: encoded.length,
      compressedSize: encoded.length
    };
  };

  var buildFirebaseDraftPayload = async function(managerData) {
    var compactJSON = JSON.stringify({
      schema: "classManagerFirebaseDraft_v1",
      exportedAt: new Date().toISOString(),
      appStorageKey: ClassManager.STORAGE_KEY,
      data: managerData
    });
    var packed = await compressTextForCloud(compactJSON);
    return Object.assign({
      schema: "classManagerFirebaseDraft_v1",
      createdAt: new Date().toISOString(),
      readyForFirebase: false,
      note: "前端已完成壓縮與限次保護；Firebase 專案建立後可將 data 欄位送入雲端。"
    }, packed);
  };

  var unpackFirebaseDraftPayload = async function(payload) {
    if (!payload || !payload.data) throw new Error("雲端資料格式不完整。");
    var bytes = base64ToBytes(payload.data);
    var text = "";
    if (payload.algorithm === "gzip-base64") {
      if (!window.DecompressionStream) {
        throw new Error("目前瀏覽器不支援解壓縮雲端資料，請改用新版 Chrome / Edge / Safari 後再載入。");
      }
      var stream = new Blob([bytes]).stream().pipeThrough(new window.DecompressionStream("gzip"));
      text = await new Response(stream).text();
    } else if (payload.algorithm === "plain-base64") {
      text = new TextDecoder().decode(bytes);
    } else {
      throw new Error("不支援的雲端資料壓縮格式。");
    }
    var parsed = JSON.parse(text);
    if (!parsed || parsed.schema !== "classManagerFirebaseDraft_v1" || !parsed.data || !Array.isArray(parsed.data.classes)) {
      throw new Error("雲端資料內容不符合班級管理格式。");
    }
    return parsed.data;
  };

  var getTodoSessionKey = function(classId, dateStr) {
    return TODO_SESSION_PREFIX + "::" + (classId || "no-class") + "::" + dateStr;
  };

  var readTodoDraft = function(classId, dateStr) {
    try { return sessionStorage.getItem(getTodoSessionKey(classId, dateStr)); }
    catch (err) { console.warn("Cannot read sessionStorage todo blackboard:", err); return null; }
  };

  var writeTodoDraft = function(classId, dateStr, text) {
    try { sessionStorage.setItem(getTodoSessionKey(classId, dateStr), text); }
    catch (err) { console.warn("Cannot write sessionStorage todo blackboard:", err); }
  };

  var clearTodoDraft = function(classId, dateStr) {
    try { sessionStorage.removeItem(getTodoSessionKey(classId, dateStr)); }
    catch (err) { console.warn("Cannot clear sessionStorage todo blackboard:", err); }
  };

  var isPinyinReady = function() {
    if (window.pinyinPro && typeof window.pinyinPro.pinyin === "function") return true;
    if (window.pinyinPro && window.pinyinPro.default && typeof window.pinyinPro.default.pinyin === "function") return true;
    return false;
  };

  var getZhuyin = function(ch) {
    return typeof window.getZhuyinForChar === "function" ? window.getZhuyinForChar(ch) : "";
  };

  var parseZhuyin = function(str) {
    if (!str) return { chars: [], tone: "", type: "" };
    var light = "\u02D9", tones = ["\u02CA", "\u02C7", "\u02CB"];
    var charsStr = str, tone = "", type = "";
    if (str.indexOf(light) >= 0) { charsStr = str.replace(light, ""); tone = light; type = "light"; }
    else { for (var i = 0; i < tones.length; i++) { if (str.indexOf(tones[i]) >= 0) { charsStr = str.replace(tones[i], ""); tone = tones[i]; type = "standard"; break; } } }
    return { chars: Array.from(charsStr.trim()), tone: tone, type: type };
  };

  var buildCharHTML = function(char, zy, fs, zyScale, zySpacing, zySqueeze) {
    if (!char) return "";
    var zySize = Math.round(fs * zyScale);
    var zyW    = Math.round(zySize * 2.4);

    if (!zy) {
      return '<div style="display:flex;align-items:center;flex-shrink:0;">'
        + '<div style="font-size:' + fs + 'px;line-height:1;font-weight:900;width:' + fs + 'px;text-align:center;">' + char + '</div>'
        + '<div style="width:' + zyW + 'px;"></div>'
        + '</div>';
    }

    var p = parseZhuyin(zy);
    var slots = p.chars.length + (p.type === "light" ? 1 : 0);
    var gap = Math.max(0.4, slots > 1 ? zySpacing - (slots - 1) * zySqueeze : zySpacing);
    var cells = [];
    if (p.type === "light") cells.push('<div class="bb-zy-light" style="height:' + gap.toFixed(2) + 'em;">' + p.tone + '</div>');
    for (var i = 0; i < p.chars.length; i++) {
      var tm = (i === p.chars.length - 1 && p.type === "standard") ? '<div class="bb-zy-tone">' + p.tone + '</div>' : "";
      cells.push('<div class="bb-zy-char" style="height:' + gap.toFixed(2) + 'em;">' + p.chars[i] + tm + '</div>');
    }

    return '<div style="display:flex;align-items:center;flex-shrink:0;">'
      + '<div style="font-size:' + fs + 'px;line-height:1;font-weight:900;width:' + fs + 'px;text-align:center;">' + char + '</div>'
      + '<div class="bb-zhuyin-track" style="font-size:' + zySize + 'px;width:' + zyW + 'px;margin-left:2px;">' + cells.join("") + '</div>'
      + '</div>';
  };

  var buildBoard = function(dateStr, hw, fs, cellHMult, zyScale, zySpacing, zySqueeze, colGapMult, overrides) {
    var d = new Date(dateStr + "T00:00:00");
    var month = d.getMonth() + 1, day = d.getDate(), dow = d.getDay();
    var zySize = Math.round(fs * zyScale);
    var zyW    = Math.round(zySize * 2.4);
    var cellH  = Math.round(fs * cellHMult);
    var colGap = Math.round(fs * colGapMult);

    var makeCell = function(inner) {
      return '<div style="height:' + cellH + 'px;display:flex;align-items:center;justify-content:flex-start;">' + inner + '</div>';
    };

    var makeCol = function(items, borderRight) {
      var br = borderRight ? "border-right:2px dashed rgba(255,248,220,0.18);" : "";
      var s = '<div style="display:flex;flex-direction:column;align-items:flex-start;flex-shrink:0;margin-right:' + colGap + 'px;' + br + '">';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.gap) { s += '<div style="height:' + Math.round(cellH * 0.3) + 'px;"></div>'; continue; }
        if (it.vdash) {
          var dashFs = Math.round(fs * 0.55);
          var dashH = Math.round(cellH * 0.55);
          s += '<div style="height:' + dashH + 'px;display:flex;align-items:center;justify-content:flex-start;">'
            + '<div style="display:flex;align-items:center;flex-shrink:0;">'
            + '<div style="font-size:' + dashFs + 'px;line-height:1;font-weight:700;width:' + fs + 'px;text-align:center;">︱</div>'
            + '<div style="width:' + zyW + 'px;"></div></div></div>';
        } else if (it.alpha) {
          var maxAlphaFs = Math.round(fs * 1.15);
          var fitFs = Math.round(fs * 0.95 / Math.max(1, it.alpha.length));
          var alphaFs = Math.min(maxAlphaFs, Math.max(fitFs, Math.round(fs * 0.7)));
          s += makeCell(
            '<div style="display:flex;align-items:center;flex-shrink:0;">'
            + '<div style="font-size:' + alphaFs + 'px;line-height:1;font-weight:800;width:' + fs + 'px;text-align:center;font-family:Arial,Helvetica,sans-serif;">'
            + it.alpha
            + '</div><div style="width:' + zyW + 'px;"></div></div>'
          );
        } else {
          s += makeCell(buildCharHTML(it.ch, it.zy, fs, zyScale, zySpacing, zySqueeze));
        }
      }
      s += '</div>';
      return s;
    };

    var ci = function(ch) {
      var zy = (overrides && overrides[ch] !== undefined) ? overrides[ch] : getZhuyin(ch);
      return { ch: ch, zy: zy };
    };

    var cols = [];
    var dateItems = [];
    Array.from(CN_NUM[month] || String(month)).forEach(function(c) { dateItems.push(ci(c)); });
    dateItems.push(ci("月"));
    Array.from(CN_NUM[day] || String(day)).forEach(function(c) { dateItems.push(ci(c)); });
    dateItems.push(ci("日"));
    dateItems.push({ gap: true });
    dateItems.push(ci("星")); dateItems.push(ci("期")); dateItems.push(ci(DAY_NAMES[dow]));
    cols.push(makeCol(dateItems, true));

    var lines = hw.split("\n");
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) continue;
      var lItems = [], lChars = Array.from(line);
      for (var lc = 0; lc < lChars.length; lc++) {
        var ch = lChars[lc];
        if (ch === "-" || ch === "~" || ch === "～" || ch === "至") {
          lItems.push({ vdash: true });
        } else if (/[a-zA-Z0-9.%]/.test(ch)) {
          var run = ch;
          while (lc + 1 < lChars.length && /[a-zA-Z0-9.%]/.test(lChars[lc + 1])) { lc++; run += lChars[lc]; }
          lItems.push({ alpha: run });
        } else { lItems.push(ci(ch)); }
      }
      cols.push(makeCol(lItems, false));
    }

    cols.reverse();
    return '<div style="display:flex;flex-direction:row;align-items:flex-start;justify-content:flex-end;height:100%;overflow:hidden;font-family:\'Noto Sans TC\',serif;">'
      + cols.join("") + '</div>';
  };

  /* ─── Shared UI Elements ─── */
  var ChalkIcon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:20px;height:20px;opacity:0.7"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="#fff8dc"/></svg>';
  var StarIcon = '<svg viewBox="0 0 24 24" fill="#fbbf24" xmlns="http://www.w3.org/2000/svg" style="width:14px;height:14px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

  function Slider(props) {
    return h("div", { style: { marginBottom: "14px" } },
      h("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: "5px" } },
        h("span", { style: { fontSize: "12px", color: "var(--manager-muted)", fontWeight: 600 } }, props.label),
        h("span", { style: { fontSize: "12px", color: "var(--manager-accent-2)", fontWeight: 700,
          background: "rgba(47,119,109,0.1)", padding: "1px 8px", borderRadius: "6px" } }, props.display)
      ),
      h("input", {
        type: "range", min: props.min, max: props.max, step: props.step, value: props.value,
        onChange: function(e) { props.onChange(Number(e.target.value)); },
        style: { width: "100%", accentColor: "var(--manager-accent-2)", cursor: "pointer" }
      })
    );
  }

  function Toggle(props) {
    return h("button", {
      onClick: props.onChange,
      style: {
        position: "relative", display: "inline-flex", alignItems: "center",
        width: "52px", height: "28px", borderRadius: "14px", border: "none", cursor: "pointer",
        background: props.value ? "linear-gradient(135deg,var(--manager-accent-2),#255f57)" : "rgba(111,78,55,0.22)",
        transition: "background 0.25s", flexShrink: 0
      }
    },
      h("span", {
        style: {
          position: "absolute", width: "20px", height: "20px", borderRadius: "10px",
          background: "#fff", top: "4px",
          left: props.value ? "28px" : "4px",
          transition: "left 0.25s", boxShadow: "0 2px 4px rgba(0,0,0,0.18)"
        }
      })
    );
  }

  /* ─── App Component ─── */
  function App() {
    var _state = useState(function() { return ClassManager.load(); });
    var data = _state[0], setData = _state[1];

    var _view = useState("overview"); // overview, blackboard, scoring, homework, grouping, tools, exam
    var currentView = _view[0], setView = _view[1];
    var _sidebar = useState(false);
    var sidebarCollapsed = _sidebar[0], setSidebarCollapsed = _sidebar[1];
    var _teacherProfile = useState(function() {
      try { return JSON.parse(localStorage.getItem("classManager_teacherProfile") || "{}"); }
      catch (err) { return {}; }
    });
    var teacherProfile = _teacherProfile[0], setTeacherProfile = _teacherProfile[1];
    var _firebaseUser = useState(function() {
      return window.ClassroomHubFirebase && window.ClassroomHubFirebase.getUser
        ? window.ClassroomHubFirebase.getUser()
        : null;
    });
    var firebaseUser = _firebaseUser[0], setFirebaseUser = _firebaseUser[1];

    var _acId = useState(function() { return data.currentClassId; });
    var activeClassId = _acId[0], setActiveClassId = _acId[1];

    var _subTab = useState("personal"); // scoring tabs: personal, group, grades
    var subTab = _subTab[0], setSubTab = _subTab[1];

    var _selHw = useState(null); // Selected Homework ID for correction checklist
    var selectedHomeworkId = _selHw[0], setSelectedHomeworkId = _selHw[1];
    var _hwSort = useState("created-desc");
    var homeworkSortMode = _hwSort[0], setHomeworkSortMode = _hwSort[1];

    /* Teacher Tools State */
    var _timeLeft = useState(0);
    var timeLeft = _timeLeft[0], setTimeLeft = _timeLeft[1];
    var _timerTotal = useState(0);
    var timerTotal = _timerTotal[0], setTimerTotal = _timerTotal[1];
    var _timerRun = useState(false);
    var isTimerRunning = _timerRun[0], setIsTimerRunning = _timerRun[1];
    var _timerBoard = useState(false);
    var timerBoardOpen = _timerBoard[0], setTimerBoardOpen = _timerBoard[1];
    var _timerModal = useState(false);
    var timerModalOpen = _timerModal[0], setTimerModalOpen = _timerModal[1];
    var _toolYoutubeEnabled = useState(function() {
      try { return localStorage.getItem("classManager_toolYoutubeEnabled") === "true"; }
      catch (err) { return false; }
    });
    var toolYoutubeEnabled = _toolYoutubeEnabled[0], setToolYoutubeEnabled = _toolYoutubeEnabled[1];
    var _toolYoutubeUrl = useState(function() {
      try { return localStorage.getItem("classManager_toolYoutubeUrl") || ""; }
      catch (err) { return ""; }
    });
    var toolYoutubeUrl = _toolYoutubeUrl[0], setToolYoutubeUrl = _toolYoutubeUrl[1];

    var _pickerList = useState([]);
    var pickerList = _pickerList[0], setPickerList = _pickerList[1];
    var _pickerTrans = useState("none");
    var pickerTransition = _pickerTrans[0], setPickerTransition = _pickerTrans[1];
    var _pickerTransf = useState("translateY(0)");
    var pickerTransform = _pickerTransf[0], setPickerTransform = _pickerTransf[1];
    var _isDrawing = useState(false);
    var isDrawing = _isDrawing[0], setIsDrawing = _isDrawing[1];
    var _pickerMode = useState("student");
    var pickerMode = _pickerMode[0], setPickerMode = _pickerMode[1];
    var _pickedName = useState("");
    var pickedName = _pickedName[0], setPickedName = _pickedName[1];
    var _pickedGroup = useState(null);
    var pickedGroup = _pickedGroup[0], setPickedGroup = _pickedGroup[1];
    var _examForm = useState({ subject: "", start: "", end: "", note: "" });
    var examForm = _examForm[0], setExamForm = _examForm[1];
    var _examBoard = useState(false);
    var examBoardOpen = _examBoard[0], setExamBoardOpen = _examBoard[1];
    var _examNow = useState(function() { return new Date(); });
    var examNow = _examNow[0], setExamNow = _examNow[1];

    /* Modals State */
    var _modClass = useState({ open: false, classId: null });
    var modalClass = _modClass[0], setModalClass = _modClass[1];
    var _modStudent = useState({ open: false, studentId: null });
    var modalStudent = _modStudent[0], setModalStudent = _modStudent[1];
    var _modHw = useState(false);
    var modalHw = _modHw[0], setModalHw = _modHw[1];
    var _modTask = useState(false);
    var modalTask = _modTask[0], setModalTask = _modTask[1];
    var _taskPresenting = useState(false);
    var taskBoardPresenting = _taskPresenting[0], setTaskBoardPresenting = _taskPresenting[1];
    var _taskIndex = useState(0);
    var taskBoardIndex = _taskIndex[0], setTaskBoardIndex = _taskIndex[1];
    var _modExport = useState(false);
    var modalExport = _modExport[0], setModalExport = _modExport[1];
    var _modPodium = useState(false);
    var modalPodium = _modPodium[0], setModalPodium = _modPodium[1];
    var _modClassPicker = useState(false);
    var modalClassPicker = _modClassPicker[0], setModalClassPicker = _modClassPicker[1];
    var _modSettings = useState(false);
    var modalSettings = _modSettings[0], setModalSettings = _modSettings[1];
    var _cloudSaving = useState(false);
    var cloudSaving = _cloudSaving[0], setCloudSaving = _cloudSaving[1];
    var _cloudRestoring = useState(false);
    var cloudRestoring = _cloudRestoring[0], setCloudRestoring = _cloudRestoring[1];
    var _cloudUsage = useState(function() { return getCloudSaveUsage(); });
    var cloudUsage = _cloudUsage[0], setCloudUsage = _cloudUsage[1];

    /* Blackboard Local Parameters */
    var bbRef = useRef(null);
    var _d = useState(getTodayStr());
    var curDate = _d[0], setDate = _d[1];
    var _f = useState(false);
    var fullsc = _f[0], setFullsc = _f[1];
    var _p = useState(isPinyinReady());
    var pyReady = _p[0], setPyReady = _p[1];
    var _t = useState(0);
    var tick = _t[0], setTick = _t[1];
    var _bs = useState({ w: 900, h: 506 });
    var boardSize = _bs[0], setBoardSize = _bs[1];
    var _cm = useState(false);
    var customMode = _cm[0], setCustomMode = _cm[1];
    var _bbPage = useState("contact");
    var blackboardPage = _bbPage[0], setBlackboardPage = _bbPage[1];
    var _bbTodo = useState(function() {
      var stored = readTodoDraft(activeClassId, getTodayStr());
      return stored !== null ? stored : DEFAULT_TODO;
    });
    var blackboardTodoText = _bbTodo[0], setBlackboardTodoText = _bbTodo[1];
    var _hz = useState(false); var hideZhuyin = _hz[0], setHideZhuyin = _hz[1];
    var _hcc = useState(function() {
      return localStorage.getItem("classManager_highContrastCorrection") === "true";
    });
    var highContrastCorrection = _hcc[0], setHighContrastCorrection = _hcc[1];

    var toggleHighContrastCorrection = function() {
      var newVal = !highContrastCorrection;
      setHighContrastCorrection(newVal);
      localStorage.setItem("classManager_highContrastCorrection", newVal ? "true" : "false");
    };

    var _fm = useState(0.8); var fsMult = _fm[0], setFsMult = _fm[1];
    var _ch = useState(1.55); var cellHMult = _ch[0], setCellHMult = _ch[1];
    var _zs = useState(0.35); var zyScale = _zs[0], setZyScale = _zs[1];
    var _zp = useState(1.1); var zySpacing = _zp[0], setZySpacing = _zp[1];
    var _zq = useState(0.1); var zySqueeze = _zq[0], setZySqueeze = _zq[1];
    var _cg = useState(0.18); var colGapMult = _cg[0], setColGapMult = _cg[1];
    var _som = useState(false);
    var showOverridesModal = _som[0], setShowOverridesModal = _som[1];

    /* Audio ref for timer */
    var timerIntervalRef = useRef(null);

    /* Fetch active class object safely */
    var activeClass = useMemo(function() {
      return data.classes.find(function(c) { return c.id === activeClassId; }) || data.classes[0] || null;
    }, [data, activeClassId]);

    /* Update global data helpers */
    var updateData = function(nextData) {
      try {
        var saved = ClassManager.save(nextData);
        setData(saved);
        return saved;
      } catch (err) {
        console.error("Unable to save class manager data:", err);
        alert("本機儲存空間不足。請先到設定匯出備份，再執行「立即整理本機資料」。");
        return data;
      }
    };

    var updateClassState = function(classId, updater) {
      var nextData = JSON.parse(JSON.stringify(data));
      var cls = nextData.classes.find(function(c) { return c.id === classId; });
      if (cls) {
        updater(cls);
        updateData(nextData);
      }
    };

    var getSortedHomeworks = function(homeworks) {
      return (homeworks || []).map(function(hw, index) {
        return { homework: hw, createdValue: getHomeworkCreatedValue(hw, index), index: index };
      }).sort(function(a, b) {
        if (a.createdValue === b.createdValue) return a.index - b.index;
        return homeworkSortMode === "created-asc"
          ? a.createdValue - b.createdValue
          : b.createdValue - a.createdValue;
      }).map(function(item) { return item.homework; });
    };

    var selectClass = function(classId, closePicker) {
      var nextData = JSON.parse(JSON.stringify(data));
      if (!nextData.classes.some(function(cls) { return cls.id === classId; })) return;
      nextData.currentClassId = classId;
      var saved = updateData(nextData);
      setActiveClassId(classId);
      setView("overview");
      if (closePicker !== false) setModalClassPicker(false);
      if (saved && saved.currentClassId) setActiveClassId(saved.currentClassId);
    };

    useEffect(function() {
      if (data.classes.length === 0) {
        setView("overview");
        setModalClass({ open: true, classId: null, onboarding: true });
      } else if (activeClass && activeClassId !== activeClass.id) {
        setActiveClassId(activeClass.id);
      }
    }, [data.classes.length, activeClassId, activeClass]);

    useEffect(function() {
      var unsubscribe = null;
      var attachFirebase = function() {
        if (!window.ClassroomHubFirebase || !window.ClassroomHubFirebase.onUserChanged) return;
        if (unsubscribe) unsubscribe();
        unsubscribe = window.ClassroomHubFirebase.onUserChanged(function(user) {
          setFirebaseUser(user);
          if (user && user.photoURL && teacherProfile.avatarUrl !== user.photoURL) {
            persistTeacherProfile(Object.assign({}, teacherProfile, { avatarUrl: user.photoURL }));
          }
        });
      };
      attachFirebase();
      window.addEventListener("classroomHubFirebaseReady", attachFirebase);
      return function() {
        window.removeEventListener("classroomHubFirebaseReady", attachFirebase);
        if (unsubscribe) unsubscribe();
      };
    }, [teacherProfile]);

    useEffect(function() {
      var stored = readTodoDraft(activeClassId, curDate);
      setBlackboardTodoText(stored !== null ? stored : DEFAULT_TODO);
    }, [activeClassId, curDate]);

    useEffect(function() {
      if (blackboardPage !== "todo") return;
      writeTodoDraft(activeClassId, curDate, blackboardTodoText);
    }, [blackboardPage, activeClassId, curDate, blackboardTodoText]);

    useEffect(function() {
      if (currentView !== "exam" && !examBoardOpen) return;
      var timer = setInterval(function() { setExamNow(new Date()); }, 1000);
      return function() { clearInterval(timer); };
    }, [currentView, examBoardOpen]);

    useEffect(function() {
      try {
        localStorage.setItem("classManager_toolYoutubeEnabled", toolYoutubeEnabled ? "true" : "false");
        localStorage.setItem("classManager_toolYoutubeUrl", toolYoutubeUrl || "");
      } catch (err) {
        console.warn("Cannot save countdown video settings", err);
      }
    }, [toolYoutubeEnabled, toolYoutubeUrl]);

    useEffect(function() {
      if (!activeClass) return;
      var now = new Date();
      var rounded = Math.ceil(now.getMinutes() / 5) * 5;
      var start = new Date(now);
      start.setMinutes(rounded % 60, 0, 0);
      if (rounded >= 60) start.setHours(start.getHours() + 1);
      var end = new Date(start.getTime() + 40 * 60000);
      var timer = Object.assign(defaultExamTimer(activeClass), activeClass.examTimer || {});
      setExamForm({
        subject: "",
        start: pad2(start.getHours()) + ":" + pad2(start.getMinutes()),
        end: pad2(end.getHours()) + ":" + pad2(end.getMinutes()),
        note: timer.note || ""
      });
    }, [activeClassId]);

    /* Incomplete homework count helper */
    var getIncompleteCount = function(cls) {
      return (cls.homeworks || []).reduce(function(total, homework) {
        return total + (homework.studentStatus || []).filter(function(item) {
          return item.status === "pending" || item.status === "needs_correction";
        }).length;
      }, 0);
    };

    var getGroupScoreTotal = function(cls) {
      return (cls.groups || []).reduce(function(total, group) {
        return total + (Number(group.score) || 0);
      }, 0);
    };

    var getTotals = function() {
      return data.classes.reduce(function(acc, cls) {
        acc.students += cls.students.length;
        acc.incomplete += getIncompleteCount(cls);
        acc.groupScore += getGroupScoreTotal(cls);
        return acc;
      }, { students: 0, incomplete: 0, groupScore: 0 });
    };

    var toolHref = function(path, classId) {
      return path + "?classId=" + encodeURIComponent(classId || (activeClass && activeClass.id) || "");
    };

    var persistTeacherProfile = function(nextProfile) {
      setTeacherProfile(nextProfile);
      try { localStorage.setItem("classManager_teacherProfile", JSON.stringify(nextProfile || {})); }
      catch (err) { console.warn("Cannot save teacher profile", err); }
    };

    var handleTeacherAvatarPrompt = async function() {
      if (window.ClassroomHubFirebase && window.ClassroomHubFirebase.signIn) {
        try {
          var user = await window.ClassroomHubFirebase.signIn();
          setFirebaseUser(user);
          if (user && user.photoURL) persistTeacherProfile(Object.assign({}, teacherProfile, { avatarUrl: user.photoURL }));
          alert(user && user.email ? "已登入：" + user.email : "已登入 Firebase / Google。");
          return;
        } catch (err) {
          console.error(err);
          alert("Firebase 登入失敗，請確認 Firebase Authentication 已啟用 Google 登入，並把 GitHub Pages 網域加入授權網域。");
        }
      }
      var url = prompt("若要先預覽 Google 大頭貼，請貼上圖片網址：", teacherProfile.avatarUrl || "");
      if (url !== null) persistTeacherProfile(Object.assign({}, teacherProfile, { avatarUrl: url.trim() }));
    };

    var openAITools = function() {
      var opened = window.open(AI_TOOLS_URL, "_blank", "noopener,noreferrer");
      if (opened) opened.opener = null;
      else window.location.href = AI_TOOLS_URL;
    };

    var pad2 = function(n) { return String(n).padStart(2, "0"); };
    var timeToMinutes = function(time) {
      var parts = String(time || "00:00").split(":").map(Number);
      return (parts[0] || 0) * 60 + (parts[1] || 0);
    };
    var timeToToday = function(time, base) {
      var d = new Date(base || new Date());
      var parts = String(time || "00:00").split(":").map(Number);
      d.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
      return d;
    };
    var formatSeconds = function(total) {
      var safe = Math.max(0, Math.floor(total || 0));
      var h = Math.floor(safe / 3600);
      var m = Math.floor((safe % 3600) / 60);
      var s = safe % 60;
      return pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    };
    var defaultExamTimer = function(cls) {
      return {
        mode: "exam",
        expectedCount: cls ? cls.students.length : 0,
        actualCount: cls ? cls.students.length : 0,
        note: "",
        timeOnly: false,
        schedule: [],
        history: []
      };
    };
    var getYoutubeEmbedUrl = function(rawUrl) {
      var raw = String(rawUrl || "").trim();
      if (!raw) return "";
      var id = "";
      try {
        var url = new URL(raw);
        var host = url.hostname.replace(/^www\./, "");
        if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
        else if (host.indexOf("youtube.com") >= 0) {
          if (url.pathname.indexOf("/embed/") === 0) id = url.pathname.split("/")[2] || "";
          else if (url.pathname.indexOf("/shorts/") === 0) id = url.pathname.split("/")[2] || "";
          else if (url.pathname.indexOf("/live/") === 0) id = url.pathname.split("/")[2] || "";
          else id = url.searchParams.get("v") || "";
        }
      } catch (err) {
        var match = raw.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
        id = match ? match[1] : "";
      }
      id = String(id || "").match(/^[A-Za-z0-9_-]{11}$/) ? id : "";
      if (!id) return "";
      var params = "rel=0&modestbranding=1&playsinline=1";
      if (typeof window !== "undefined" && window.location && /^https?:/.test(window.location.protocol)) {
        params += "&origin=" + encodeURIComponent(window.location.origin);
      }
      return "https://www.youtube.com/embed/" + id + "?" + params;
    };
    var formatStorageSize = function(bytes) {
      var safe = Math.max(0, Number(bytes) || 0);
      if (safe >= 1024 * 1024) return (safe / 1024 / 1024).toFixed(2) + " MB";
      return Math.max(1, Math.round(safe / 1024)) + " KB";
    };

    /* Setup effects */
    useEffect(function() {
      var t = setInterval(function() {
        if (isPinyinReady()) {
          setPyReady(true);
          setTick(function(v) { return v + 1; });
          clearInterval(t);
        }
      }, 400);
      return function() { clearInterval(t); };
    }, []);

    useEffect(function() {
      var fn = function() { setFullsc(!!document.fullscreenElement); };
      document.addEventListener("fullscreenchange", fn);
      document.addEventListener("webkitfullscreenchange", fn);
      return function() {
        document.removeEventListener("fullscreenchange", fn);
        document.removeEventListener("webkitfullscreenchange", fn);
      };
    }, []);

    /* Measure board sizes for blackboard proportional rendering */
    var measureBoard = function() {
      var el = bbRef.current;
      if (!el) return;
      setBoardSize({
        w: Math.max(200, el.offsetWidth - 28),
        h: Math.max(100, el.offsetHeight - 28)
      });
    };

    useEffect(function() {
      if (currentView === "blackboard") {
        var id = setTimeout(measureBoard, 80);
        window.addEventListener("resize", measureBoard);
        var ro = null;
        if (window.ResizeObserver && bbRef.current) {
          ro = new ResizeObserver(measureBoard);
          ro.observe(bbRef.current);
        }
        return function() {
          clearTimeout(id);
          window.removeEventListener("resize", measureBoard);
          if (ro) ro.disconnect();
        };
      }
    }, [currentView, fullsc]);

    /* Timer Widget Logic */
    useEffect(function() {
      if (isTimerRunning && timeLeft > 0) {
        timerIntervalRef.current = setInterval(function() {
          setTimeLeft(function(prev) {
            if (prev <= 1) {
              clearInterval(timerIntervalRef.current);
              setIsTimerRunning(false);
              try {
                var audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-84.wav");
                audio.play();
              } catch (err) { console.warn("Audio error", err); }
              alert("時間到！");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        clearInterval(timerIntervalRef.current);
      }
      return function() { clearInterval(timerIntervalRef.current); };
    }, [isTimerRunning, timeLeft]);

    var openTimerModal = function() {
      setTimerModalOpen(true);
    };

    var renderTimerModal = function() {
      if (!timerModalOpen) return null;
      return h("div", { className: "modal-backdrop visible timer-modal-backdrop" },
        h("div", { className: "cm-glass modal-card timer-custom-modal" },
          h("div", { className: "modal-header" },
            h("div", null,
              h("div", { className: "cm-eyebrow" }, "COUNTDOWN"),
              h("h2", null, "設定倒數時間"),
              h("p", null, "輸入課堂活動需要的分鐘與秒數。")
            ),
            h("button", { className: "cm-button", onClick: function() { setTimerModalOpen(false); } }, "關閉")
          ),
          h("form", {
            onSubmit: function(e) {
              e.preventDefault();
              var form = e.currentTarget;
              var m = parseInt(form.elements.timerMinutes.value, 10) || 0;
              var s = parseInt(form.elements.timerSeconds.value, 10) || 0;
              var total = Math.max(0, m * 60 + s);
              setIsTimerRunning(false);
              setTimeLeft(total);
              setTimerTotal(total);
              setTimerModalOpen(false);
            }
          },
            h("div", { className: "timer-modal-grid" },
              h("label", null, "分鐘", h("input", {
                name: "timerMinutes",
                type: "number",
                min: "0",
                defaultValue: Math.floor(timeLeft / 60) || 5
              })),
              h("label", null, "秒", h("input", {
                name: "timerSeconds",
                type: "number",
                min: "0",
                max: "59",
                defaultValue: timeLeft % 60
              }))
            ),
            h("div", { className: "timer-modal-presets" },
              [180, 300, 600, 900].map(function(sec) {
                return h("button", {
                  key: sec,
                  type: "button",
                  className: "cm-button",
                  onClick: function() {
                    setIsTimerRunning(false);
                    setTimeLeft(sec);
                    setTimerTotal(sec);
                    setTimerModalOpen(false);
                  }
                }, Math.floor(sec / 60) + "分");
              })
            ),
            h("div", { className: "modal-actions timer-modal-actions" },
              h("button", { type: "button", className: "cm-button", onClick: function() { setTimerModalOpen(false); } }, "取消"),
              h("button", { type: "submit", className: "cm-button cm-primary" }, "套用時間")
            )
          )
        )
      );
    };

    /* Picker Draw Logic */
    var getGroupPickerEntries = function(cls) {
      if (!cls) return [];
      return Array.from({ length: cls.groupCount || 4 }, function(_, idx) {
        var groupId = idx + 1;
        var groupInfo = (cls.groups || []).find(function(g) { return Number(g.id) === groupId; }) || { id: groupId, score: 0 };
        var members = (cls.students || []).filter(function(s) { return Number(s.group) === groupId; });
        return {
          id: groupId,
          label: "第 " + groupId + " 組",
          score: Number(groupInfo.score) || 0,
          members: members.map(function(s) { return { id: s.id, name: s.name }; })
        };
      }).filter(function(group) { return group.members.length > 0; });
    };

    var drawPickerStudent = function() {
      if (!activeClass || activeClass.students.length === 0) return;
      setIsDrawing(true);
      setPickedName("");
      setPickedGroup(null);
      var students = activeClass.students.slice();
      var list = [];
      for (var i = 0; i < 5; i++) {
        list = list.concat(students.slice().sort(function() { return Math.random() - 0.5; }));
      }
      var winner = students[Math.floor(Math.random() * students.length)];
      var winnerIndex = list.length - 5;
      list.splice(winnerIndex, 0, winner);

      setPickerList(list.map(function(s) { return s.name; }));
      setPickerTransform("translateY(0)");
      setPickerTransition("none");

      setTimeout(function() {
        setPickerTransition("transform 4s cubic-bezier(0.2, 0.8, 0.2, 1)");
        var nameHeight = 70;
        var viewportHeight = 70;
        var position = (winnerIndex * nameHeight) - (viewportHeight / 2) + (nameHeight / 2);
        setPickerTransform("translateY(-" + position + "px)");
        setTimeout(function() {
          setPickedName(winner.name);
          setIsDrawing(false);
        }, 4000);
      }, 100);
    };

    var drawPickerGroup = function() {
      if (!activeClass) return;
      var groups = getGroupPickerEntries(activeClass);
      if (!groups.length) {
        alert("目前沒有可抽籤的小組。請先到分組模式完成分組。");
        return;
      }
      setIsDrawing(true);
      setPickedName("");
      setPickedGroup(null);
      var list = [];
      for (var i = 0; i < 5; i++) {
        list = list.concat(groups.slice().sort(function() { return Math.random() - 0.5; }));
      }
      var winner = groups[Math.floor(Math.random() * groups.length)];
      var winnerIndex = list.length - 5;
      list.splice(winnerIndex, 0, winner);

      setPickerList(list.map(function(group) { return group.label; }));
      setPickerTransform("translateY(0)");
      setPickerTransition("none");

      setTimeout(function() {
        setPickerTransition("transform 4s cubic-bezier(0.2, 0.8, 0.2, 1)");
        var nameHeight = 70;
        var viewportHeight = 70;
        var position = (winnerIndex * nameHeight) - (viewportHeight / 2) + (nameHeight / 2);
        setPickerTransform("translateY(-" + position + "px)");
        setTimeout(function() {
          setPickedName(winner.label);
          setPickedGroup(winner);
          setIsDrawing(false);
        }, 4000);
      }, 100);
    };

    /* Core Action Implementations */
    var handleStudentScoreUpdate = function(e, studentId, amount) {
      var card = e.currentTarget.closest(".student-card");
      if (card) {
        var feedback = document.createElement("div");
        feedback.className = "ios-feedback";
        var icon = document.createElement("div");
        icon.className = "ios-feedback-icon";
        icon.textContent = amount > 0 ? "＋" : "－";
        icon.style.backgroundColor = "rgba(" + (amount > 0 ? "48, 209, 88" : "255, 69, 58") + ", 0.8)";
        feedback.appendChild(icon);
        card.appendChild(feedback);
        setTimeout(function() { feedback.remove(); }, 600);
      }

      updateClassState(activeClassId, function(cls) {
        var s = cls.students.find(function(item) { return item.id === studentId; });
        if (s) s.score += amount;
      });
    };

    var handleGroupPersonalScoreUpdate = function(e, groupId, amount) {
      var col = e.currentTarget.closest(".group-column");
      if (col) {
        var feedback = document.createElement("div");
        feedback.className = "ios-feedback";
        var icon = document.createElement("div");
        icon.className = "ios-feedback-icon";
        icon.textContent = amount > 0 ? "＋" : "－";
        icon.style.backgroundColor = "rgba(" + (amount > 0 ? "48, 209, 88" : "255, 69, 58") + ", 0.8)";
        feedback.appendChild(icon);
        col.appendChild(feedback);
        setTimeout(function() { feedback.remove(); }, 600);
      }

      updateClassState(activeClassId, function(cls) {
        cls.students.forEach(function(s) {
          if (String(s.group) === String(groupId)) {
            s.score += amount;
          }
        });
      });
    };

    var handleGroupCompetitionScoreUpdate = function(e, groupId, amount) {
      var col = e.currentTarget.closest(".group-column");
      if (col) {
        var feedback = document.createElement("div");
        feedback.className = "ios-feedback";
        var icon = document.createElement("div");
        icon.className = "ios-feedback-icon";
        icon.textContent = "🏆";
        icon.style.backgroundColor = "rgba(251, 191, 36, 0.85)";
        feedback.appendChild(icon);
        col.appendChild(feedback);
        setTimeout(function() { feedback.remove(); }, 600);
      }

      updateClassState(activeClassId, function(cls) {
        var g = cls.groups.find(function(item) { return String(item.id) === String(groupId); });
        if (g) g.score += amount;
      });
    };

    var handleRandomGrouping = function() {
      if (!activeClass) return;
      updateClassState(activeClassId, function(cls) {
        var count = cls.groupCount || 4;
        var shuffled = cls.students.slice().sort(function() { return Math.random() - 0.5; });
        shuffled.forEach(function(s, idx) {
          s.group = (idx % count) + 1;
        });
      });
    };

    var handleGroupCountChange = function(newVal) {
      var val = Math.max(1, parseInt(newVal, 10) || 4);
      updateClassState(activeClassId, function(cls) {
        cls.groupCount = val;
        var list = cls.groups || [];
        cls.groups = Array.from({ length: val }, function(_, idx) {
          var id = idx + 1;
          var existing = list.find(function(item) { return Number(item.id) === id; }) || {};
          return { id: id, score: Number(existing.score) || 0 };
        });
      });
    };

    var handleGradesCalculation = function() {
      updateClassState(activeClassId, function(cls) {
        var scores = cls.students.map(function(s) { return s.score; });
        if (!scores.length) return;
        var min = Math.min.apply(null, scores);
        var max = Math.max.apply(null, scores);
        var range = max - min;
        cls.students.forEach(function(s) {
          s.grade = Math.round((range === 0) ? 90 : 80 + ((s.score - min) / range) * 20);
        });
      });
    };

    var handleScoresReset = function() {
      if (confirm("確定要將所有學生的分數與平時成績重置嗎？")) {
        updateClassState(activeClassId, function(cls) {
          cls.students.forEach(function(s) {
            s.score = 0;
            s.grade = null;
          });
          cls.groups.forEach(function(g) {
            g.score = 0;
          });
        });
      }
    };

    var handleCopyGrades = function() {
      if (!activeClass) return;
      var tsv = "姓名\t淨分\t平時分數\n";
      activeClass.students.forEach(function(s) {
        tsv += s.name + "\t" + s.score + "\t" + (s.grade || "-") + "\n";
      });
      navigator.clipboard.writeText(tsv).then(function() {
        alert("成績資料已複製到剪貼簿！");
      });
    };

    var handleBackupExport = function() {
      var blob = new Blob([JSON.stringify(ClassManager.load(), null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "班級管理_本機備份_" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(a.href);
    };

    var handleBackupImport = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(evt) {
        try {
          var parsed = JSON.parse(evt.target.result);
          if (parsed && Array.isArray(parsed.classes)) {
            if (confirm("確定要匯入此備份資料嗎？這將覆蓋本機端目前的班級設定。")) {
              var saved = updateData(parsed);
              setActiveClassId(saved.currentClassId || (saved.classes[0] && saved.classes[0].id) || null);
              setView("overview");
              setModalSettings(false);
              setModalClassPicker(false);
              alert("匯入成功！");
            }
          } else {
            alert("匯入失敗：檔案格式不正確。");
          }
        } catch (err) {
          alert("匯入失敗：無法解析 JSON 檔案。");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    };

    var handleCloudDraftSave = async function() {
      if (cloudSaving) return;
      var usage = getCloudSaveUsage();
      if ((usage.count || 0) >= CLOUD_DAILY_LIMIT) {
        alert("今天已達儲存上限 3 次。這是為了避免連續點擊造成雲端紀錄覆蓋或資料量暴增。");
        setCloudUsage(usage);
        return;
      }
      setCloudSaving(true);
      try {
        var cleaned = ClassManager.cleanup ? ClassManager.cleanup() : ClassManager.load();
        setData(cleaned);
        setActiveClassId(cleaned.currentClassId || (cleaned.classes[0] && cleaned.classes[0].id) || null);
        var payload = await buildFirebaseDraftPayload(cleaned);
        var draft = {
          schema: "classManagerFirebaseDraftEnvelope_v1",
          savedAt: new Date().toISOString(),
          target: "firebase-pending",
          payload: payload
        };
        try {
          localStorage.setItem(CLOUD_DRAFT_KEY, JSON.stringify(draft));
        } catch (err) {
          throw new Error("壓縮草稿暫存失敗，請先匯出本機備份或整理本機資料。");
        }
        var nextUsage = {
          date: getTodayStr(),
          count: (usage.count || 0) + 1,
          lastSavedAt: draft.savedAt,
          compressedSize: payload.compressedSize,
          originalSize: payload.originalSize,
          algorithm: payload.algorithm,
          status: "已準備雲端草稿"
        };
        saveCloudSaveUsage(nextUsage);
        setCloudUsage(nextUsage);
        var savedTarget = "本機壓縮草稿";
        if (window.ClassroomHubFirebase && window.ClassroomHubFirebase.saveDraft) {
          try {
            var cloudUser = await window.ClassroomHubFirebase.saveDraft(draft, nextUsage);
            setFirebaseUser(cloudUser);
            if (cloudUser && cloudUser.photoURL) persistTeacherProfile(Object.assign({}, teacherProfile, { avatarUrl: cloudUser.photoURL }));
            savedTarget = "Firebase 雲端";
          } catch (cloudErr) {
            console.error(cloudErr);
            alert("Firebase 上傳失敗，已先保留本機壓縮草稿。請確認已啟用 Google 登入、Firestore Database 與安全規則。");
          }
        }
        alert("已儲存到" + savedTarget + "（今日第 " + nextUsage.count + " / " + CLOUD_DAILY_LIMIT + " 次）。");
      } catch (err) {
        console.error(err);
        alert(err.message || "儲存資料失敗，請先匯出本機備份後再試。");
      } finally {
        setCloudSaving(false);
      }
    };

    var handleCloudDraftRestore = async function() {
      if (cloudRestoring) return;
      setCloudRestoring(true);
      var sourceLabel = "本機壓縮草稿";
      var draft = null;

      if (window.ClassroomHubFirebase && window.ClassroomHubFirebase.loadDraft) {
        try {
          draft = await window.ClassroomHubFirebase.loadDraft();
          if (draft) sourceLabel = "Firebase 雲端";
          var cloudUser = window.ClassroomHubFirebase.getUser && window.ClassroomHubFirebase.getUser();
          if (cloudUser) setFirebaseUser(cloudUser);
          if (cloudUser && cloudUser.photoURL) persistTeacherProfile(Object.assign({}, teacherProfile, { avatarUrl: cloudUser.photoURL }));
        } catch (cloudErr) {
          console.error(cloudErr);
          alert("Firebase 載入失敗，將改讀本機壓縮草稿。請確認已啟用 Google 登入、Firestore Database 與安全規則。");
        }
      }

      var raw = null;
      if (!draft) {
        try {
          raw = localStorage.getItem(CLOUD_DRAFT_KEY);
        } catch (err) {
          alert("無法讀取雲端草稿。請確認瀏覽器允許本機儲存。");
          setCloudRestoring(false);
          return;
        }
        if (!raw) {
          alert("目前沒有可載入的雲端資料。請先登入並儲存一次。");
          setCloudRestoring(false);
          return;
        }

        try {
          draft = JSON.parse(raw);
        } catch (err) {
          alert("雲端草稿格式損壞，請重新儲存一次資料。");
          setCloudRestoring(false);
          return;
        }
      }

      var savedAt = draft.savedAt ? new Date(draft.savedAt).toLocaleString("zh-TW") : "未知時間";
      if (!confirm("確定要從" + sourceLabel + "載入資料？\n\n資料時間：" + savedAt + "\n這會覆蓋目前本機端的班級資料。")) {
        setCloudRestoring(false);
        return;
      }

      try {
        var restoredData = await unpackFirebaseDraftPayload(draft.payload);
        var saved = ClassManager.save(restoredData);
        setData(saved);
        setActiveClassId(saved.currentClassId || (saved.classes[0] && saved.classes[0].id) || null);
        setView("overview");
        setModalSettings(false);
        setModalClassPicker(false);
        alert("已從" + sourceLabel + "恢復完成。");
      } catch (err) {
        console.error(err);
        alert(err.message || "載入雲端資料失敗。");
      } finally {
        setCloudRestoring(false);
      }
    };

    var handleApplyLegacyBlackboard = function() {
      var stored = ClassManager.load();
      if (activeClass && stored.legacyImports && stored.legacyImports.blackboard) {
        updateClassState(activeClass.id, function(cls) {
          cls.blackboard = {
            homeworkByDate: Object.assign({}, stored.legacyImports.blackboard.homeworkByDate),
            charOverrides: Object.assign({}, stored.legacyImports.blackboard.charOverrides)
          };
        });
        var nextStored = ClassManager.load();
        nextStored.legacyImports.blackboard = null;
        updateData(nextStored);
        alert("舊黑板資料套用成功！");
      }
    };

    /* ─── Rendering Helper Modules ─── */
    var renderSidebar = function() {
      if (sidebarCollapsed) return null;
      return h("aside", { className: "cm-sidebar rail" },
        h("div", { className: "cm-brand brand-mark" },
          h("div", { className: "cm-brand-icon brand-badge teacher-avatar-slot" },
            teacherProfile && teacherProfile.avatarUrl
              ? h("img", { src: teacherProfile.avatarUrl, alt: "老師頭像" })
              : "班"
          ),
          h("div", { className: "brand-copy" },
            h("div", { className: "cm-brand-title brand-title" }, "班級管理"),
            h("div", { className: "cm-brand-subtitle brand-subtitle" }, "本機端教師工作台"),
            h("button", {
              className: "mini-firebase-button",
              onClick: handleTeacherAvatarPrompt
            }, firebaseUser && firebaseUser.email ? "已登入 Google" : "Firebase / Google")
          )
        ),
        h("div", { className: "cm-section-label rail-section-title" }, "目前班級"),
        h("button", {
          className: "current-class-button",
          onClick: function() {
            if (data.classes.length) setModalClassPicker(true);
            else setModalClass({ open: true, classId: null, onboarding: true });
          }
        },
          activeClass
            ? h(React.Fragment, null,
                h("span", null, "正在使用"),
                h("strong", null, activeClass.name),
                h("small", null, activeClass.students.length + " 位學生 · 待辦 " + getIncompleteCount(activeClass))
              )
            : h(React.Fragment, null,
                h("span", null, "尚未建立班級"),
                h("strong", null, "建立第一個班級"),
                h("small", null, "開始使用前需要一份學生名單")
              )
        ),
        activeClass && h(React.Fragment, null,
          h("div", { className: "cm-section-label" }, "功能"),
          h("nav", { className: "cm-nav-list" },
            h("button", {
              className: "cm-nav-link " + (currentView === "overview" ? "is-active active" : ""),
              onClick: function() { setView("overview"); }
            }, h("span", { className: "cm-nav-icon" }, "⌂"), h("span", null, "首頁")),
            h("button", {
              className: "cm-nav-link " + (currentView === "blackboard" ? "is-active active" : ""),
              onClick: function() { setView("blackboard"); }
            }, h("span", { className: "cm-nav-icon" }, "▣"), h("span", null, "班級黑板")),
            h("button", {
              className: "cm-nav-link " + (currentView === "scoring" ? "is-active active" : ""),
              onClick: function() { setView("scoring"); setSubTab("personal"); }
            }, h("span", { className: "cm-nav-icon" }, "✦"), h("span", null, "加分系統")),
            h("button", {
              className: "cm-nav-link " + (currentView === "homework" ? "is-active active" : ""),
              onClick: function() { setView("homework"); setSelectedHomeworkId(null); }
            }, h("span", { className: "cm-nav-icon" }, "◎"), h("span", null, "作業訂正")),
            h("button", {
              className: "cm-nav-link " + (currentView === "grouping" ? "is-active active" : ""),
              onClick: function() { setView("grouping"); }
            }, h("span", { className: "cm-nav-icon" }, "▥"), h("span", null, "分組模式")),
            h("button", {
              className: "cm-nav-link " + (currentView === "tools" ? "is-active active" : ""),
              onClick: function() { setView("tools"); }
            }, h("span", { className: "cm-nav-icon" }, "◉"), h("span", null, "抽籤計時")),
            h("button", {
              className: "cm-nav-link cm-exam-mode " + (currentView === "exam" ? "is-active active" : ""),
              onClick: function() { setView("exam"); setExamBoardOpen(false); }
            }, h("span", { className: "cm-nav-icon" }, "⏱"), h("span", null, "考試計時"))
          )
        ),
        h("div", { className: "cm-sidebar-footer rail-actions" },
          h("button", {
            className: "cm-button cm-primary btn primary",
            onClick: function() { setModalSettings(true); }
          }, "設定")
        )
      );
    };

    var renderOverviewContent = function(totals) {
      var todayKey = getTodayStr();
      var today = new Date();
      var todayLabel = (today.getMonth() + 1) + "月" + today.getDate() + "日 星期" + DAY_NAMES[today.getDay()];
      var featureCards = activeClass ? [
        { id: "blackboard", icon: "▣", title: "班級黑板", desc: "寫聯絡簿、課堂代辦，適合投影到教室前方。", action: function() { setView("blackboard"); } },
        { id: "scoring", icon: "✦", title: "加分系統", desc: "幫學生或小組加分，快速累積平時表現。", action: function() { setView("scoring"); setSubTab("personal"); } },
        { id: "homework", icon: "◎", title: "作業訂正", desc: "看誰未交、誰要訂正、誰已經完成。", action: function() { setView("homework"); setSelectedHomeworkId(null); } },
        { id: "grouping", icon: "▥", title: "分組模式", desc: "整理座號與小組，臨時活動也能快速分組。", action: function() { setView("grouping"); } },
        { id: "exam", icon: "⏱", title: "考試計時", desc: "開啟段考倒數，或只顯示課堂時間。", action: function() { setView("exam"); setExamBoardOpen(false); } }
      ] : [];

      if (!activeClass) {
        return h("div", { className: "feature-home first-use-home" },
          h("section", { className: "cm-card feature-home-hero first-use-panel" },
            h("div", null,
              h("div", { className: "cm-eyebrow" }, "第一次使用"),
              h("h2", null, "先建立一個班級"),
              h("p", null, "這個工具會以班級為中心保存黑板、加分、作業、分組與考試資料。")
            ),
            h("button", {
              className: "cm-button cm-primary",
              onClick: function() { setModalClass({ open: true, classId: null, onboarding: true }); }
            }, "建立第一個班級")
          )
        );
      }

      var todayBlackboard = activeClass.blackboard && activeClass.blackboard.homeworkByDate
        ? String(activeClass.blackboard.homeworkByDate[todayKey] || "").trim()
        : "";
      var todayPreviewLines = todayBlackboard.split("\n").map(function(line) { return line.trim(); }).filter(Boolean).slice(0, 3);
      var incompleteCount = getIncompleteCount(activeClass);
      var groupedStudents = (activeClass.students || []).filter(function(student) {
        return Number(student.group) >= 1 && Number(student.group) <= (activeClass.groupCount || 4);
      }).length;
      var groupEntries = getGroupPickerEntries(activeClass);
      var quickActions = [
        { id: "blackboard", label: "開黑板", action: function() { setView("blackboard"); } },
        { id: "homework", label: "查作業", action: function() { setView("homework"); setSelectedHomeworkId(null); } },
        { id: "tools", label: "抽籤/倒數", action: function() { setView("tools"); } },
        { id: "ai", label: "使用AI工具", action: openAITools }
      ];
      var cloudRemaining = Math.max(0, CLOUD_DAILY_LIMIT - (cloudUsage.count || 0));
      var cloudDraftMeta = getCloudDraftMeta();
      var reminders = [
        {
          id: "blackboard",
          label: todayBlackboard ? "今日黑板已填寫" : "今日黑板尚未填寫",
          value: todayBlackboard ? "已完成" : "待填寫",
          tone: todayBlackboard ? "is-ok" : "is-warn",
          action: function() { setView("blackboard"); }
        },
        {
          id: "homework",
          label: "作業待處理",
          value: incompleteCount + " 人次",
          tone: incompleteCount ? "is-warn" : "is-ok",
          action: function() { setView("homework"); setSelectedHomeworkId(null); }
        },
        {
          id: "grouping",
          label: "分組狀態",
          value: groupEntries.length ? groupEntries.length + " 組" : "未分組",
          tone: groupEntries.length && groupedStudents === activeClass.students.length ? "is-ok" : "is-soft",
          action: function() { setView("grouping"); }
        }
      ];

      return h("div", { className: "feature-home simplified-home" },
        h("div", { className: "cm-card feature-home-hero daily-home-hero" },
          h("div", null,
            h("div", { className: "cm-eyebrow" }, todayLabel),
            h("h2", null, "今天要做什麼？"),
            h("p", null, activeClass.name + " · 每天常用功能集中在右側，換班級請點左側目前班級。")
          ),
          h("div", { className: "daily-home-actions-panel" },
            h("div", { className: "daily-quick-actions" },
              quickActions.map(function(item) {
                return h("button", {
                  key: item.id,
                  className: "cm-button " + (item.id === "blackboard" || item.id === "ai" ? "cm-primary" : "cm-secondary"),
                  onClick: item.action
                }, item.label);
              })
            ),
            h("div", { className: "cloud-mini-panel" },
              h("div", { className: "cloud-mini-copy" },
                h("span", null, "雲端資料"),
                h("strong", null, "今日剩餘 " + cloudRemaining + " / " + CLOUD_DAILY_LIMIT)
              ),
              h("div", { className: "cloud-save-actions cloud-mini-actions" },
                h("button", {
                  className: "cm-button cm-primary",
                  disabled: cloudSaving || cloudRemaining <= 0,
                  onClick: handleCloudDraftSave
                }, cloudSaving ? "壓縮中..." : "儲存"),
                h("button", {
                  className: "cm-button cm-secondary",
                  disabled: cloudRestoring,
                  onClick: handleCloudDraftRestore
                }, cloudRestoring ? "載入中..." : "載入")
              ),
              h("div", { className: "cloud-mini-meta" },
                cloudDraftMeta
                  ? "可載入：" + new Date(cloudDraftMeta.savedAt).toLocaleString("zh-TW")
                  : "尚無可載入資料"
              )
            )
          )
        ),
        h("div", { className: "daily-workbench-grid" },
          h("section", { className: "cm-card daily-reminders-card" },
            h("div", { className: "daily-section-head" },
              h("div", null,
                h("div", { className: "cm-eyebrow" }, "TODAY"),
                h("h3", null, "待處理提醒")
              )
            ),
            h("div", { className: "daily-reminder-list" },
              reminders.map(function(item) {
                return h("button", { key: item.id, className: "daily-reminder-item " + item.tone, onClick: item.action },
                  h("span", null, item.label),
                  h("strong", null, item.value)
                );
              })
            )
          ),
          h("section", { className: "cm-card daily-board-preview" },
            h("div", { className: "daily-section-head" },
              h("div", null,
                h("div", { className: "cm-eyebrow" }, "BLACKBOARD"),
                h("h3", null, "今日黑板預覽")
              ),
              h("button", { className: "cm-button cm-secondary", onClick: function() { setView("blackboard"); } }, todayBlackboard ? "查看" : "填寫")
            ),
            todayPreviewLines.length
              ? h("ol", null, todayPreviewLines.map(function(line, idx) { return h("li", { key: idx }, line); }))
              : h("div", { className: "daily-empty-preview" }, "今天還沒有聯絡簿內容。")
          )
        ),
        h("div", { className: "feature-launch-grid" },
          featureCards.map(function(item) {
            return h("button", { key: item.id, className: "cm-card feature-launch-card", onClick: item.action },
              h("span", { className: "feature-icon" }, item.icon),
              h("strong", null, item.title),
              h("span", null, item.desc)
            );
          })
        )
      );
    };

    var renderBlackboardContent = function() {
      if (!activeClass) return null;
      var todayHW = activeClass.blackboard && activeClass.blackboard.homeworkByDate && activeClass.blackboard.homeworkByDate[curDate] !== undefined
        ? activeClass.blackboard.homeworkByDate[curDate]
        : DEFAULT_HOMEWORK;
      var activeBlackboardText = blackboardPage === "todo" ? blackboardTodoText : todayHW;
      var activeBlackboardMeta = blackboardPage === "todo"
        ? { title: "課堂代辦黑板", subtitle: "每日暫存 • 關閉分頁後消失", inputTitle: "課堂代辦內容", placeholder: "每行輸入一項課堂代辦或提醒", hint: "此頁使用分頁暫存，不會寫入班級本機資料。" }
        : { title: "聯絡簿黑板", subtitle: "每日聯絡簿 • 本機保存", inputTitle: "聯絡簿內容", placeholder: "每行文字在黑板上會自動排列成一直欄...", hint: "換行即為換直欄，英文與數字會自動旋轉為橫排。" };

      var charOverrides = activeClass.blackboard && activeClass.blackboard.charOverrides ? activeClass.blackboard.charOverrides : {};

      var fs = Math.round(boardSize.w / 1300 * 52 * fsMult);
      var pad = Math.round(fs * 0.85);

      var boardHTML = pyReady
        ? buildBoard(curDate, activeBlackboardText, fs, cellHMult, zyScale, zySpacing, zySqueeze, colGapMult, charOverrides)
        : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(255,248,220,0.35);font-size:18px;font-family:serif;">注音引擎載入中...</div>';

      var uniqueChars = [];
      var set = new Set();
      Array.from(activeBlackboardText).forEach(function(ch) {
        if (/[\u4e00-\u9fa5]/.test(ch)) set.add(ch);
      });
      uniqueChars = Array.from(set);

      return h("div", { className: "blackboard-page" },
        h("div", { className: "app-layout", style: { display: "grid", gridTemplateColumns: "330px 1fr", gap: "24px" } },
          /* Left Sidebar Controls */
          h("div", { className: "sidebar-scroll", style: { display: "flex", flexDirection: "column", gap: "16px" } },
            h("div", { className: "blackboard-tabs panel cm-card", style: { padding: "8px" } },
              h("button", {
                className: "blackboard-tab " + (blackboardPage === "contact" ? "is-active" : ""),
                onClick: function() { setBlackboardPage("contact"); }
              },
                h("strong", null, "聯絡簿黑板"),
                h("span", null, "保存每日內容")
              ),
              h("button", {
                className: "blackboard-tab " + (blackboardPage === "todo" ? "is-active" : ""),
                onClick: function() { setBlackboardPage("todo"); }
              },
                h("strong", null, "課堂代辦黑板"),
                h("span", null, "分頁暫存")
              )
            ),
            /* Date Picker Panel */
            h("div", { className: "panel cm-card", style: { padding: "16px", background: "rgba(255,255,255,0.4)" } },
              h("div", { className: "panel-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" } },
                h("span", { className: "panel-title", style: { fontWeight: "bold" } }, "📅 今日日期"),
                h("span", { className: "badge " + (pyReady ? "badge-success" : "badge-warning"), style: {
                  fontSize: "11px", padding: "2px 8px", borderRadius: "999px",
                  background: pyReady ? "rgba(48,209,88,0.15)" : "rgba(255,159,10,0.15)",
                  color: pyReady ? "#24b243" : "#f19c12"
                } }, pyReady ? "● 注音就緒" : "● 載入中")
              ),
              h("div", { className: "panel-body" },
                h("div", { className: "date-picker-wrap", style: { display: "flex", gap: "8px", alignItems: "center" } },
                  h("button", { className: "date-nav-btn btn", style: { padding: "6px 12px" }, onClick: function() {
                    var d = new Date(curDate + "T00:00:00");
                    d.setDate(d.getDate() - 1);
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    setDate(d.toISOString().split("T")[0]);
                  } }, "◀"),
                  h("input", {
                    type: "date",
                    value: curDate,
                    onChange: function(e) { setDate(e.target.value); },
                    style: { flex: 1, minWidth: 0, padding: "8px", borderRadius: "8px", border: "1px solid var(--manager-line)", background: "rgba(255,255,255,0.6)" }
                  }),
                  h("button", { className: "date-nav-btn btn", style: { padding: "6px 12px" }, onClick: function() {
                    var d = new Date(curDate + "T00:00:00");
                    d.setDate(d.getDate() + 1);
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    setDate(d.toISOString().split("T")[0]);
                  } }, "▶")
                ),
                h("div", { className: "date-display", style: { marginTop: "10px", fontSize: "14px", fontWeight: "bold", textAlign: "center", color: "var(--manager-accent)" } },
                  (function() {
                    var d = new Date(curDate + "T00:00:00");
                    return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日 (星期" + DAY_NAMES[d.getDay()] + ")";
                  })()
                )
              )
            ),

            /* Blackboard Text Input Panel */
            h("div", { className: "panel cm-card", style: { padding: "16px", background: "rgba(255,255,255,0.4)" } },
              h("div", { className: "panel-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" } },
                h("span", { className: "panel-title", style: { fontWeight: "bold" } }, "✍️ " + activeBlackboardMeta.inputTitle),
                h("button", {
                  className: "btn primary",
                  style: { padding: "4px 10px", fontSize: "11px", height: "auto", minHeight: "auto" },
                  onClick: function() { setShowOverridesModal(true); }
                }, "注音修正")
              ),
              h("div", { className: "panel-body" },
                h("textarea", {
                  className: "input-field",
                  style: { width: "100%", padding: "12px", borderRadius: "12px", border: "1px solid var(--manager-line)", background: "rgba(255,255,255,0.7)", fontFamily: "monospace", resize: "vertical" },
                  value: activeBlackboardText,
                  onChange: function(e) {
                    if (blackboardPage === "todo") {
                      setBlackboardTodoText(e.target.value);
                      writeTodoDraft(activeClassId, curDate, e.target.value);
                    } else {
                      updateBlackboardHomework(curDate, e.target.value);
                    }
                  },
                  rows: 7,
                  placeholder: activeBlackboardMeta.placeholder
                }),
                h("p", { className: "hint-text cm-muted", style: { marginTop: "8px", fontSize: "11px" } },
                  "💡 " + activeBlackboardMeta.hint
                ),
                blackboardPage === "todo" && h("button", {
                  className: "btn reset-btn todo-clear-btn",
                  style: { width: "100%", marginTop: "8px", fontSize: "12px", padding: "6px", border: "1px dashed var(--manager-line)" },
                  onClick: function() {
                    if (confirm("清空今天這個分頁中的課堂代辦暫存內容？")) {
                      clearTodoDraft(activeClassId, curDate);
                      setBlackboardTodoText(DEFAULT_TODO);
                    }
                  }
                }, "清空今日暫存")
              )
            ),

            /* Custom Styling Sliders Panel */
            h("div", { className: "panel cm-card", style: { padding: "16px", background: "rgba(255,255,255,0.4)" } },
              h("div", { className: "panel-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" } },
                h("span", { className: "panel-title", style: { fontWeight: "bold" } }, "⚙️ 排版細節"),
                h(Toggle, { value: customMode, onChange: function() { setCustomMode(!customMode); } })
              ),
              customMode && h("div", { className: "panel-body" },
                h(Slider, { label: "中文大小", min: 0.5, max: 1.8, step: 0.05, value: fsMult, onChange: setFsMult, display: Math.round(fsMult * 100) + "%" }),
                h(Slider, { label: "行高字距", min: 1.2, max: 2.8, step: 0.05, value: cellHMult, onChange: setCellHMult, display: cellHMult.toFixed(2) + "×" }),
                h(Slider, { label: "直欄間距", min: 0, max: 0.5, step: 0.02, value: colGapMult, onChange: setColGapMult, display: Math.round(colGapMult * 100) + "%" }),
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" } },
                  h("span", { style: { fontSize: "12px", color: "var(--manager-muted)", fontWeight: 600 } }, "隱藏注音顯示"),
                  h(Toggle, { value: hideZhuyin, onChange: function() { setHideZhuyin(!hideZhuyin); } })
                ),
                h(Slider, { label: "注音大小", min: 0.22, max: 0.52, step: 0.01, value: zyScale, onChange: setZyScale, display: Math.round(zyScale * 100) + "%" }),
                h(Slider, { label: "注音間距", min: 0.5, max: 1.5, step: 0.05, value: zySpacing, onChange: setZySpacing, display: zySpacing.toFixed(2) + "em" }),
                h(Slider, { label: "注音擠壓", min: 0, max: 0.3, step: 0.01, value: zySqueeze, onChange: setZySqueeze, display: zySqueeze.toFixed(2) }),
                h("button", {
                  className: "btn reset-btn",
                  style: { width: "100%", marginTop: "8px", fontSize: "12px", padding: "6px", border: "1px dashed var(--manager-line)" },
                  onClick: function() {
                    setFsMult(0.8); setCellHMult(1.55); setZyScale(0.35);
                    setZySpacing(1.1); setZySqueeze(0.1); setColGapMult(0.18);
                    setHideZhuyin(false);
                  }
                }, "↺ 重設為預設值")
              )
            )
          ),

          /* Right Main Blackboard Canvas */
          h("div", { className: "board-wrap " + (blackboardPage === "todo" ? "todo-board-mode" : "contact-board-mode"), style: { display: "flex", flexDirection: "column", gap: "12px" } },
            h("div", { className: "cm-card blackboard-mode-heading", style: { padding: "12px 14px", display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "center", flexWrap: "wrap" } },
              h("div", null,
                h("div", { className: "cm-eyebrow" }, blackboardPage === "todo" ? "TEMP BOARD" : "CONTACT BOOK"),
                h("strong", null, activeBlackboardMeta.title)
              ),
              h("span", { className: "cm-pill" }, activeBlackboardMeta.subtitle)
            ),
            h("div", {
              ref: bbRef,
              className: "blackboard-bg" + (hideZhuyin ? " hide-zhuyin" : ""),
              style: { width: "100%", aspectRatio: "16/9", position: "relative", borderRadius: "20px", overflow: "hidden", boxShadow: "inset 0 0 40px rgba(0,0,0,0.5)" }
            },
              h("button", {
                className: "btn-fullscreen cm-button",
                style: { position: "absolute", top: "12px", right: "140px", zIndex: 10, background: "rgba(0,0,0,0.4)", color: "#fff", border: "none", borderRadius: "8px", padding: "6px 12px", cursor: "pointer" },
                onClick: function() { setHideZhuyin(!hideZhuyin); }
              }, hideZhuyin ? "👁 顯示注音" : "🙈 隱藏注音"),
              h("button", {
                className: "btn-fullscreen cm-button",
                style: { position: "absolute", top: "12px", right: "12px", zIndex: 10, background: "rgba(0,0,0,0.4)", color: "#fff", border: "none", borderRadius: "8px", padding: "6px 12px", cursor: "pointer" },
                onClick: function() {
                  var el = bbRef.current;
                  if (!el) return;
                  if (!document.fullscreenElement) {
                    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
                    if (fn) fn.call(el);
                  } else {
                    var efn = document.exitFullscreen || document.webkitExitFullscreen;
                    if (efn) efn.call(document);
                  }
                }
              }, fullsc ? "✕ 退出全螢幕" : "⛶ 全螢幕模式"),
              h("div", {
                style: {
                  position: "absolute",
                  top: pad + "px", left: pad + "px",
                  right: pad + "px", bottom: pad + "px",
                  overflow: "hidden"
                },
                dangerouslySetInnerHTML: { __html: boardHTML }
              })
            ),
            h("div", { className: "info-bar", style: { display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(255,255,255,0.4)", borderRadius: "12px", fontSize: "12px", color: "var(--manager-muted)" } },
              h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h("span", { dangerouslySetInnerHTML: { __html: StarIcon } }), "中文大小: " + fs + "px"),
              h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h("span", { dangerouslySetInnerHTML: { __html: StarIcon } }), "注音大小: " + Math.round(fs * zyScale) + "px"),
              h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, h("span", { dangerouslySetInnerHTML: { __html: StarIcon } }), "看板解析度: " + boardSize.w + " × " + boardSize.h + " px"),
              h("div", { style: { display: "flex", gap: "6px", alignItems: "center" }, className: blackboardPage === "todo" ? "todo-temp-status" : "" }, h("span", { dangerouslySetInnerHTML: { __html: StarIcon } }), blackboardPage === "todo" ? "課堂代辦：分頁暫存" : "聯絡簿：本機保存")
            )
          )
        ),

        /* Advanced Overrides Modal (Inside Blackboard page) */
        showOverridesModal && h("div", { className: "modal-backdrop visible" },
          h("div", { className: "cm-glass modal-card", style: { width: "min(680px, 100%)" } },
            h("div", { className: "modal-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" } },
              h("div", null,
                h("h2", { className: "modal-title", style: { margin: 0 } }, "🎯 漢字注音人工修正"),
                h("div", { className: "cm-muted", style: { fontSize: "12px", marginTop: "4px" } }, "可直接修改本篇文章內漢字的注音與聲調，不影響字典預設值")
              ),
              h("button", { className: "btn", onClick: function() { setShowOverridesModal(false); } }, "✕")
            ),
            h("div", { className: "modal-body", style: { maxHeight: "400px", overflowY: "auto", paddingRight: "8px" } },
              uniqueChars.length === 0
                ? h("div", { style: { textAlign: "center", padding: "24px", color: "var(--manager-muted)" } }, "黑板內容目前沒有任何中文字。")
                : h("div", { className: "overrides-grid", style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "10px" } },
                    uniqueChars.map(function(ch) {
                      var currentVal = charOverrides[ch] !== undefined ? charOverrides[ch] : getZhuyin(ch);
                      return h("div", { key: ch, className: "override-item", style: { display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.4)", padding: "6px 8px", borderRadius: "10px", border: "1px solid var(--manager-line)" } },
                        h("span", { className: "override-char", style: { fontWeight: "bold", fontSize: "18px", width: "24px", textAlign: "center" } }, ch),
                        h("input", {
                          type: "text",
                          className: "override-input",
                          style: { width: "100%", padding: "4px 6px", border: "1px solid var(--manager-line)", borderRadius: "6px", background: "rgba(255,255,255,0.7)" },
                          value: currentVal,
                          placeholder: "無注音",
                          onChange: function(e) {
                            updateCharOverride(ch, e.target.value);
                          }
                        })
                      );
                    })
                  )
            ),
            h("div", { className: "modal-footer", style: { display: "flex", justifyContent: "space-between", marginTop: "18px" } },
              h("button", {
                className: "btn danger",
                onClick: function() {
                  if (confirm("確定要清空這篇文章所有手動修正的漢字注音嗎？")) {
                    updateClassState(activeClassId, function(cls) {
                      cls.blackboard = cls.blackboard || {};
                      cls.blackboard.charOverrides = {};
                    });
                  }
                }
              }, "重設所有漢字"),
              h("button", { className: "btn primary", onClick: function() { setShowOverridesModal(false); } }, "✓ 完成設定")
            )
          )
        )
      );
    };

    var updateBlackboardHomework = function(dateStr, text) {
      updateClassState(activeClassId, function(cls) {
        cls.blackboard = cls.blackboard || {};
        cls.blackboard.homeworkByDate = cls.blackboard.homeworkByDate || {};
        cls.blackboard.homeworkByDate[dateStr] = text;
      });
    };

    var updateCharOverride = function(char, val) {
      updateClassState(activeClassId, function(cls) {
        cls.blackboard = cls.blackboard || {};
        cls.blackboard.charOverrides = cls.blackboard.charOverrides || {};
        if (val.trim() === "") {
          delete cls.blackboard.charOverrides[char];
        } else {
          cls.blackboard.charOverrides[char] = val.trim();
        }
      });
    };

    var renderScoringContent = function() {
      if (!activeClass) return null;

      if (subTab === "personal") {
        var studentCards = activeClass.students.slice().sort(function(a, b) {
          return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
        }).map(function(student) {
          return h("div", {
            key: student.id,
            className: "card student-card",
            style: { position: "relative" },
            "data-student-id": student.id
          },
            h("div", { className: "student-card-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
              h("span", { className: "student-name", style: { fontWeight: "bold" } }, student.id + ". " + student.name),
              h("button", {
                className: "class-action-btn edit-student-btn",
                style: { border: "none", background: "none", cursor: "pointer", fontSize: "14px" },
                onClick: function() { setModalStudent({ open: true, studentId: student.id }); }
              }, "✏️")
            ),
            h("div", { className: "student-score", style: { fontSize: "2.4em", fontWeight: "900", textAlign: "center", margin: "14px 0" } }, student.score),
            h("div", { className: "score-controls", style: { display: "flex", gap: "8px" } },
              h("button", {
                className: "btn danger score-btn",
                style: { flex: 1 },
                onClick: function(e) { handleStudentScoreUpdate(e, student.id, -1); }
              }, "-"),
              h("button", {
                className: "btn primary score-btn",
                style: { flex: 1, background: "#24b243" },
                onClick: function(e) { handleStudentScoreUpdate(e, student.id, 1); }
              }, "+")
            )
          );
        });

        return h("div", null,
          h("div", { className: "tab-actions", style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginBottom: "16px", flexWrap: "wrap" } },
            h("button", {
              className: "btn secondary",
              onClick: function() { setView("grouping"); }
            }, "前往分組模式"),
            h("button", {
              className: "btn primary",
              onClick: function() { setModalStudent({ open: true, studentId: null }); }
            }, "新增學生")
          ),
          h("div", { className: "dashboard-grid", style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "16px" } }, studentCards)
        );
      }

      if (subTab === "group") {
        var sortedGroups = (activeClass.groups || []).slice().sort(function(a, b) {
          return b.score - a.score;
        });

        var groupRankingCards = (activeClass.groups || []).map(function(group) {
          return h("div", {
            key: group.id,
            className: "card group-column",
            "data-group-id": group.id,
            style: { padding: "16px", borderRadius: "16px", background: "rgba(255,255,255,0.45)", position: "relative" }
          },
            h("div", { className: "group-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
              h("h3", { style: { margin: 0 } }, "第 " + group.id + " 組"),
              h("div", { className: "score-controls", style: { display: "flex", gap: "6px" } },
                h("button", {
                  className: "btn danger score-btn group-personal",
                  onClick: function(e) { handleGroupPersonalScoreUpdate(e, group.id, -1); },
                  title: "組員個人各扣 1 分"
                }, "-"),
                h("button", {
                  className: "btn score-btn group-personal",
                  style: { background: "#24b243", color: "#fff" },
                  onClick: function(e) { handleGroupPersonalScoreUpdate(e, group.id, 1); },
                  title: "組員個人各加 1 分"
                }, "+"),
                h("button", {
                  className: "btn score-btn group-competition",
                  style: { background: "var(--manager-warm)", color: "#fff", fontSize: "1.2em", padding: "4px 8px" },
                  onClick: function(e) { handleGroupCompetitionScoreUpdate(e, group.id, 1); },
                  title: "小組競賽點數 +1"
                }, "🏆")
              )
            ),
            h("div", { style: { marginTop: "14px" } },
              h("div", { style: { fontSize: "13px", color: "var(--manager-muted)" } }, "競賽累積積分:"),
              h("div", { style: { fontSize: "2.2em", fontWeight: "900", color: "var(--manager-accent)" } }, group.score)
            )
          );
        });

        return h("div", null,
          h("div", { className: "tab-actions", style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginBottom: "16px", flexWrap: "wrap" } },
            h("button", {
              className: "btn secondary",
              onClick: function() { setView("grouping"); }
            }, "前往分組模式"),
            h("button", {
              className: "btn primary",
              style: { background: "var(--manager-warm)" },
              onClick: function() { setModalPodium(true); }
            }, "🏆 顯示積分頒獎台")
          ),
          h("div", { className: "dashboard-grid", style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" } }, groupRankingCards)
        );
      }

      if (subTab === "grades") {
        var rows = activeClass.students.slice().sort(function(a, b) {
          return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
        }).map(function(s) {
          return h("tr", { key: s.id },
            h("td", { style: { padding: "10px 14px", borderBottom: "1px solid var(--manager-line)" } }, s.id + ". " + s.name),
            h("td", { style: { padding: "10px 14px", borderBottom: "1px solid var(--manager-line)", fontWeight: "bold" } }, s.score),
            h("td", { style: { padding: "10px 14px", borderBottom: "1px solid var(--manager-line)", color: "var(--manager-accent-2)", fontWeight: "bold" } }, s.grade !== null ? s.grade : "-")
          );
        });

        return h("div", null,
          h("div", { className: "tab-actions", style: { display: "flex", gap: "10px", justifyContent: "flex-end", marginBottom: "16px" } },
            h("button", { className: "btn secondary", onClick: function() { setView("grouping"); } }, "前往分組模式"),
            h("button", { className: "btn primary", style: { background: "#24b243" }, onClick: handleGradesCalculation }, "計算平時成績"),
            h("button", { className: "btn secondary", onClick: handleCopyGrades }, "複製成績名單"),
            h("button", { className: "btn danger", onClick: handleScoresReset }, "重設所有分數")
          ),
          h("div", { className: "grades-table-container" },
            h("table", { id: "grades-table", style: { width: "100%", borderCollapse: "collapse", textAlign: "left" } },
              h("thead", null,
                h("tr", null,
                  h("th", { style: { padding: "12px 14px" } }, "座號/姓名"),
                  h("th", { style: { padding: "12px 14px" } }, "累積淨分"),
                  h("th", { style: { padding: "12px 14px" } }, "平時成績 (80-100分級)")
                )
              ),
              h("tbody", null, rows)
            )
          )
        );
      }

      return null;
    };

    var renderToolsContent = function() {
      if (!activeClass) return null;
      var minutes = Math.floor(timeLeft / 60);
      var seconds = timeLeft % 60;
      var display = (minutes < 10 ? "0" + minutes : minutes) + ":" + (seconds < 10 ? "0" + seconds : seconds);
      var studentCount = activeClass.students.length;
      var groupPickerEntries = getGroupPickerEntries(activeClass);
      var toolYoutubeEmbedUrl = toolYoutubeEnabled ? getYoutubeEmbedUrl(toolYoutubeUrl) : "";
      var timerBase = Math.max(timerTotal || 0, timeLeft || 0, 1);
      var timerProgressDeg = Math.max(0, Math.min(360, Math.round((timeLeft / timerBase) * 360)));
      var isFilePage = typeof window !== "undefined" && window.location && window.location.protocol === "file:";
      var countdownBubble = h("div", {
        className: "tool-countdown-bubble",
        style: { "--timer-progress": timerProgressDeg + "deg" }
      },
        h("span", null, isTimerRunning ? "倒數中" : "倒數"),
        h("strong", null, formatSeconds(timeLeft))
      );

      if (timerBoardOpen) {
        return h("div", { className: "tool-countdown-board " + (toolYoutubeEnabled ? "has-video" : "timer-only") },
          h("div", { className: "tool-countdown-toolbar" },
            h("button", { className: "cm-button", onClick: function() { setTimerBoardOpen(false); } }, "返回工具"),
            h("div", { className: "tool-countdown-controls" },
              h("button", {
                className: "cm-button",
                disabled: timeLeft <= 0,
                onClick: function() {
                  if (!timerTotal) setTimerTotal(timeLeft);
                  setIsTimerRunning(!isTimerRunning);
                }
              }, isTimerRunning ? "暫停" : "開始"),
              h("button", {
                className: "cm-button cm-primary",
                onClick: function() {
                  var el = document.querySelector(".tool-countdown-board");
                  if (el && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen();
                  else if (document.fullscreenElement) document.exitFullscreen();
                }
              }, "全螢幕")
            )
          ),
          h("div", { className: "tool-countdown-stage" },
            toolYoutubeEnabled && h("section", { className: "tool-video-stage cm-card" },
              toolYoutubeEmbedUrl
                ? h("iframe", {
                    src: toolYoutubeEmbedUrl,
                    title: "倒數計時 YouTube 影片",
                    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
                    allowFullScreen: true,
                    referrerPolicy: "strict-origin-when-cross-origin"
                  })
                : h("div", { className: "tool-video-placeholder" },
                    h("strong", null, "無法辨識 YouTube 網址"),
                    h("span", null, "請返回工具設定，貼上 youtube.com/watch 或 youtu.be 的影片連結。")
                  ),
              isFilePage && h("div", { className: "tool-video-warning" }, "若 YouTube 顯示錯誤 153，請用本機伺服器網址開啟此工具。"),
              countdownBubble
            ),
            !toolYoutubeEnabled && h("section", { className: "tool-countdown-time cm-card" },
              h("span", null, isTimerRunning ? "倒數中" : "倒數計時"),
              h("strong", null, formatSeconds(timeLeft))
            )
          )
        );
      }

      return h(React.Fragment, null,
        h("div", { className: "teacher-tools-page" },
        h("section", { className: "tool-hero-card cm-card" },
          h("div", null,
            h("div", { className: "cm-eyebrow" }, "TEACHER TOOLS"),
            h("h2", null, "抽籤與課堂計時"),
            h("p", null, "名單綁定目前班級，可直接用於點名、問答、分組前暖身與課堂倒數。")
          ),
          h("div", { className: "tool-class-chip" },
            h("strong", null, activeClass.name),
            h("span", null, studentCount + " 位學生")
          )
        ),
        h("div", { className: "teacher-tool-grid" },
          h("section", { className: "tool-panel tool-timer-card cm-card" },
            h("div", { className: "tool-panel-head" },
              h("div", null,
                h("div", { className: "cm-eyebrow" }, "COUNTDOWN"),
                h("h3", null, "課堂計時器")
              ),
              h("span", { className: "tool-status-pill " + (isTimerRunning ? "is-live" : "") }, isTimerRunning ? "進行中" : "待命")
            ),
            h("button", {
              type: "button",
              className: "tool-timer-display",
              onClick: openTimerModal,
              title: "點擊輸入自訂時間"
            }, display),
            h("div", { className: "timer-presets tool-presets" },
              [180, 300, 600, 900].map(function(sec) {
                return h("button", {
                  key: sec,
                  className: "cm-button",
                  onClick: function() { setTimeLeft(sec); setTimerTotal(sec); setIsTimerRunning(false); }
                }, Math.floor(sec / 60) + "分");
              })
            ),
            h("div", { className: "tool-video-config" },
              h("div", { className: "tool-video-config-head" },
                h("div", null,
                  h("strong", null, "YouTube 影片"),
                  h("span", null, "開啟後投影時影片放大，倒數縮小")
                ),
                h("label", { className: "cm-switch" },
                  h("input", {
                    type: "checkbox",
                    checked: !!toolYoutubeEnabled,
                    onChange: function(e) { setToolYoutubeEnabled(e.target.checked); }
                  }),
                  h("span", { className: "cm-switch-track" },
                    h("span", { className: "cm-switch-thumb" })
                  )
                )
              ),
              h("input", {
                type: "url",
                value: toolYoutubeUrl,
                placeholder: "貼上 youtube.com/watch?v=... 或 youtu.be/...",
                onChange: function(e) { setToolYoutubeUrl(e.target.value); }
              })
            ),
            h("div", { className: "tool-actions" },
              h("button", {
                className: "cm-button cm-primary",
                disabled: timeLeft <= 0,
                onClick: function() {
                  if (!timerTotal) setTimerTotal(timeLeft);
                  setIsTimerRunning(!isTimerRunning);
                }
              }, isTimerRunning ? "暫停" : "開始"),
              h("button", {
                className: "cm-button",
                onClick: function() { setTimerBoardOpen(true); }
              }, "投影倒數"),
              h("button", {
                className: "cm-button",
                onClick: function() { setIsTimerRunning(false); setTimeLeft(0); setTimerTotal(0); }
              }, "重設"),
              h("button", {
                className: "cm-button",
                onClick: openTimerModal
              }, "自訂")
            )
          ),
          h("section", { className: "tool-panel tool-picker-card cm-card" },
            h("div", { className: "tool-panel-head" },
              h("div", null,
                h("div", { className: "cm-eyebrow" }, "RANDOM PICKER"),
                h("h3", null, pickerMode === "group" ? "分組抽籤" : "班級抽籤")
              ),
              h("span", { className: "tool-status-pill" }, pickerMode === "group" ? groupPickerEntries.length + " 組" : studentCount + " 人")
            ),
            h("div", { className: "picker-mode-switch" },
              h("button", {
                className: "picker-mode-button " + (pickerMode === "student" ? "is-active" : ""),
                onClick: function() {
                  setPickerMode("student");
                  setPickedName("");
                  setPickedGroup(null);
                  setPickerList([]);
                  setPickerTransform("translateY(0)");
                  setPickerTransition("none");
                }
              }, "學生抽籤"),
              h("button", {
                className: "picker-mode-button " + (pickerMode === "group" ? "is-active" : ""),
                onClick: function() {
                  setPickerMode("group");
                  setPickedName("");
                  setPickedGroup(null);
                  setPickerList([]);
                  setPickerTransform("translateY(0)");
                  setPickerTransition("none");
                }
              }, "分組抽籤")
            ),
            h("div", { className: "tool-picker-stage " + (isDrawing ? "is-drawing" : "") },
              h("div", { className: "tool-orbit orbit-one" }),
              h("div", { className: "tool-orbit orbit-two" }),
              h("div", { className: "picker-viewport tool-picker-viewport" },
                h("div", {
                  className: "picker-wheel",
                  style: {
                    transition: pickerTransition,
                    transform: pickerTransform
                  }
                },
                  (pickerList.length ? pickerList : (pickerMode === "group" ? (groupPickerEntries.length ? groupPickerEntries.map(function(g) { return g.label; }) : ["尚未分組"]) : activeClass.students.map(function(s) { return s.name; }))).map(function(name, idx) {
                    return h("div", { key: idx, className: "picker-name" }, name);
                  })
                )
              )
            ),
            h("div", { className: "picked-name-card " + (pickedName ? "has-result" : "") },
              h("span", null, pickedName ? (pickerMode === "group" ? "本次抽中小組" : "本次抽中") : (pickerMode === "group" ? "分組來源" : "名單來源")),
              h("strong", null, pickedName || (pickerMode === "group" ? (groupPickerEntries.length ? "目前分組" : "尚未分組") : activeClass.name)),
              pickedGroup && h("div", { className: "picked-group-members" },
                pickedGroup.members.map(function(member) {
                  return h("span", { key: member.id }, member.id + ". " + member.name);
                })
              )
            ),
            h("div", { className: "tool-actions" },
              h("button", {
                className: "cm-button cm-primary",
                disabled: isDrawing || (pickerMode === "student" ? studentCount === 0 : groupPickerEntries.length === 0),
                onClick: pickerMode === "group" ? drawPickerGroup : drawPickerStudent
              }, isDrawing ? "抽籤中..." : (pickerMode === "group" ? "抽出小組" : "開始抽籤")),
              pickerMode === "group" && h("button", {
                className: "cm-button",
                onClick: function() { setView("grouping"); }
              }, "前往分組"),
              h("button", {
                className: "cm-button",
                onClick: function() { setPickedName(""); setPickedGroup(null); setPickerList([]); setPickerTransform("translateY(0)"); setPickerTransition("none"); }
              }, "清除結果")
            )
          )
        )
      ),
        renderTimerModal()
      );
    };

    var renderExamContent = function() {
      if (!activeClass) return null;
      var timer = Object.assign(defaultExamTimer(activeClass), activeClass.examTimer || {});
      var list = (timer.schedule || []).slice().sort(function(a, b) { return timeToMinutes(a.start) - timeToMinutes(b.start); });
      var current = list.find(function(item) { return examNow >= timeToToday(item.start, examNow) && examNow < timeToToday(item.end, examNow); });
      var next = list.find(function(item) { return examNow < timeToToday(item.start, examNow); });
      var target = current ? timeToToday(current.end, examNow) : (next ? timeToToday(next.start, examNow) : null);
      var clockText = pad2(examNow.getHours()) + ":" + pad2(examNow.getMinutes()) + ":" + pad2(examNow.getSeconds());
      var countdownText = target ? formatSeconds((target - examNow) / 1000) : "完成";
      var boardSubject = current ? current.subject : (next ? next.subject : "今日考程結束");

      var updateTimer = function(mutator) {
        updateClassState(activeClassId, function(cls) {
          cls.examTimer = Object.assign(defaultExamTimer(cls), cls.examTimer || {});
          mutator(cls.examTimer);
        });
      };

      var startBoard = function(mode) {
        var sessionId = "S" + Date.now();
        updateTimer(function(nextTimer) {
          nextTimer.mode = mode;
          nextTimer.timeOnly = mode === "classTime";
          nextTimer.note = examForm.note || "";
          nextTimer.history = nextTimer.history || [];
          nextTimer.activeSessionId = sessionId;
          nextTimer.history.unshift({
            id: sessionId,
            classId: activeClass.id,
            className: activeClass.name,
            startedAt: new Date().toISOString(),
            endedAt: null,
            durationSeconds: 0,
            mode: mode,
            expectedCount: nextTimer.expectedCount,
            actualCount: nextTimer.actualCount,
            note: mode === "classTime" ? "" : nextTimer.note,
            timeOnly: mode === "classTime",
            scheduleSnapshot: (nextTimer.schedule || []).map(function(item) { return Object.assign({}, item); })
          });
        });
        setExamBoardOpen(true);
      };

      var closeBoard = function() {
        updateTimer(function(nextTimer) {
          if (!nextTimer.activeSessionId) return;
          var row = (nextTimer.history || []).find(function(item) { return item.id === nextTimer.activeSessionId; });
          if (row && !row.endedAt) {
            row.endedAt = new Date().toISOString();
            row.durationSeconds = Math.max(0, Math.round((new Date(row.endedAt) - new Date(row.startedAt)) / 1000));
          }
          delete nextTimer.activeSessionId;
        });
        setExamBoardOpen(false);
      };

      if (examBoardOpen) {
        return h("div", { className: "exam-integrated-board " + (timer.mode === "classTime" ? "is-class-time" : "is-exam") },
          h("div", { className: "exam-board-toolbar" },
            h("button", { className: "cm-button", onClick: closeBoard }, "返回設定"),
            h("button", {
              className: "cm-button cm-primary",
              onClick: function() {
                var el = document.querySelector(".exam-integrated-board");
                if (el && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen();
                else if (document.fullscreenElement) document.exitFullscreen();
              }
            }, "全螢幕")
          ),
          timer.mode === "classTime"
            ? h("div", { className: "exam-class-clock cm-card" },
                h("span", { className: "class-time-kicker" }, "CLASS TIME"),
                h("div", { className: "exam-class-clock-time" }, clockText),
                h("div", { className: "exam-class-clock-date" }, examNow.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" }))
              )
            : h("div", { className: "exam-board-grid" },
                h("aside", { className: "cm-card exam-board-schedule" },
                  h("div", { className: "cm-eyebrow" }, "SCHEDULE"),
                  h("h3", null, "今日考程"),
                  h("div", { className: "exam-mini-list" },
                    list.length ? list.map(function(item) {
                      var state = examNow >= timeToToday(item.end, examNow) ? "past" : (examNow >= timeToToday(item.start, examNow) && examNow < timeToToday(item.end, examNow) ? "active" : "");
                      return h("div", { key: item.id, className: "exam-mini-item " + state },
                        h("strong", null, item.start),
                        h("span", null, item.subject)
                      );
                    }) : h("div", { className: "cm-muted" }, "尚未建立考程")
                  )
                ),
                h("main", { className: "cm-card exam-board-main" },
                  h("div", { className: "exam-clock-small" }, clockText),
                  h("div", { className: "exam-board-label" }, current ? "距離本節結束" : (next ? "距離下一節開始" : "今日考程")),
                  h("div", { className: "exam-board-subject" }, boardSubject),
                  h("div", { className: "exam-board-countdown" }, countdownText),
                  timer.note && h("div", { className: "exam-board-note" }, timer.note)
                )
              )
        );
      }

      return h("div", { className: "exam-integrated-page" },
        h("section", { className: "cm-card exam-integrated-hero" },
          h("div", null,
            h("div", { className: "cm-eyebrow" }, "EXAM TIMER"),
            h("h2", null, "考試計時"),
            h("p", null, "段考模式與課堂時間模式已整合在班級管理內，切換功能不會開新分頁。")
          ),
          h("div", { className: "exam-mode-actions" },
            h("button", {
              className: "cm-button " + (timer.mode === "exam" ? "cm-primary" : "cm-secondary"),
              onClick: function() { updateTimer(function(nextTimer) { nextTimer.mode = "exam"; nextTimer.timeOnly = false; }); }
            }, "段考模式"),
            h("button", {
              className: "cm-button " + (timer.mode === "classTime" ? "cm-primary" : "cm-secondary"),
              onClick: function() { updateTimer(function(nextTimer) { nextTimer.mode = "classTime"; nextTimer.timeOnly = true; }); }
            }, "課堂時間模式")
          )
        ),
        h("div", { className: "exam-setup-grid" },
          h("aside", { className: "cm-card exam-start-panel" },
            h("div", { className: "exam-field-grid" },
              h("label", null, "應到", h("input", {
                type: "number",
                value: timer.expectedCount,
                onChange: function(e) { updateTimer(function(nextTimer) { nextTimer.expectedCount = Number(e.target.value) || 0; }); }
              })),
              h("label", null, "實到", h("input", {
                type: "number",
                value: timer.actualCount,
                onChange: function(e) { updateTimer(function(nextTimer) { nextTimer.actualCount = Number(e.target.value) || 0; }); }
              }))
            ),
            h("button", {
              className: "cm-button cm-exam-mode",
              onClick: function() {
                if (timer.mode !== "classTime" && !list.length) return alert("請先新增至少一個考程。");
                startBoard(timer.mode === "classTime" ? "classTime" : "exam");
              }
            }, timer.mode === "classTime" ? "開啟課堂時間模式" : "一鍵開啟段考模式")
          ),
          h("main", { className: "exam-editor-stack" },
            timer.mode !== "classTime" && h("div", { className: "exam-compose-grid" },
              h("section", { className: "cm-card exam-builder-card" },
                h("div", { className: "cm-eyebrow" }, "SCHEDULE SETUP"),
                h("h3", null, "新增考程"),
                h("label", null, "考試內容", h("input", {
                  value: examForm.subject,
                  placeholder: "例如：數學第一單元",
                  onChange: function(e) { setExamForm(Object.assign({}, examForm, { subject: e.target.value })); }
                })),
                h("div", { className: "exam-time-inputs" },
                  h("label", null, "開始", h("input", {
                    type: "time",
                    value: examForm.start,
                    onChange: function(e) { setExamForm(Object.assign({}, examForm, { start: e.target.value })); }
                  })),
                  h("label", null, "結束", h("input", {
                    type: "time",
                    value: examForm.end,
                    onChange: function(e) { setExamForm(Object.assign({}, examForm, { end: e.target.value })); }
                  }))
                ),
                h("button", {
                  className: "cm-button cm-primary",
                  onClick: function() {
                    var subject = examForm.subject.trim();
                    if (!subject) return alert("請輸入考試內容。");
                    if (!examForm.start || !examForm.end) return alert("請選擇開始與結束時間。");
                    if (timeToMinutes(examForm.end) <= timeToMinutes(examForm.start)) return alert("結束時間需晚於開始時間。");
                    updateTimer(function(nextTimer) {
                      nextTimer.schedule = nextTimer.schedule || [];
                      nextTimer.schedule.push({ id: "E" + Date.now(), subject: subject, start: examForm.start, end: examForm.end, date: getTodayStr() });
                    });
                    setExamForm(Object.assign({}, examForm, { subject: "" }));
                  }
                }, "新增考程")
              ),
              h("section", { className: "cm-card exam-note-card" },
                h("div", { className: "cm-eyebrow" }, "REMINDER"),
                h("h3", null, "考試小叮嚀"),
                h("textarea", {
                  rows: 7,
                  value: examForm.note,
                  placeholder: "例如：先寫姓名、答案卡畫記清楚、最後五分鐘檢查。",
                  onChange: function(e) {
                    setExamForm(Object.assign({}, examForm, { note: e.target.value }));
                    updateTimer(function(nextTimer) { nextTimer.note = e.target.value; });
                  }
                })
              )
            ),
            timer.mode !== "classTime" && h("section", { className: "cm-card exam-section-card" },
              h("div", { className: "exam-section-head" },
                h("h3", null, "考試時程"),
                h("button", { className: "cm-button", onClick: function() { updateTimer(function(nextTimer) { nextTimer.schedule = []; }); } }, "清空")
              ),
              h("div", { className: "exam-schedule-list" },
                list.length ? list.map(function(item) {
                  return h("div", { key: item.id, className: "exam-schedule-item" },
                    h("div", { className: "exam-schedule-time" }, h("strong", null, item.start), h("span", null, item.end)),
                    h("div", null, h("strong", null, item.subject), h("span", null, (timeToMinutes(item.end) - timeToMinutes(item.start)) + " 分鐘")),
                    h("button", {
                      className: "cm-button",
                      onClick: function() { updateTimer(function(nextTimer) { nextTimer.schedule = (nextTimer.schedule || []).filter(function(row) { return row.id !== item.id; }); }); }
                    }, "刪除")
                  );
                }) : h("div", { className: "cm-empty", style: { minHeight: "130px" } }, h("div", null, h("h3", null, "尚未建立考程"), h("p", null, "新增至少一個考程後即可啟動段考模式。")))
              )
            ),
            h("section", { className: "cm-card exam-section-card" },
              h("div", { className: "exam-section-head" },
                h("h3", null, "使用紀錄"),
                h("button", { className: "cm-button", onClick: function() { updateTimer(function(nextTimer) { nextTimer.history = []; }); } }, "清除")
              ),
              h("div", { className: "exam-history-list" },
                (timer.history || []).length ? (timer.history || []).slice(0, 8).map(function(item) {
                  var subjects = item.mode === "classTime" || item.timeOnly ? "課堂時間" : ((item.scheduleSnapshot || []).map(function(s) { return s.subject; }).join("、") || "未命名考程");
                  var duration = item.durationSeconds ? " · 使用 " + formatSeconds(item.durationSeconds) : (item.endedAt ? "" : " · 進行中");
                  return h("div", { key: item.id, className: "history-item" },
                    h("strong", null, subjects),
                    h("div", { className: "history-meta" }, new Date(item.startedAt).toLocaleString("zh-TW") + " · " + (item.mode === "classTime" || item.timeOnly ? "課堂時間模式" : "段考模式") + duration)
                  );
                }) : h("div", { className: "cm-muted" }, "尚無紀錄")
              )
            )
          )
        )
      );
    };

    var renderHomeworkContent = function() {
      if (!activeClass) return null;

      /* Case 1: Individual Homework Student Status Checklist view */
      if (selectedHomeworkId !== null) {
        var homework = activeClass.homeworks.find(function(hw) { return hw.id === selectedHomeworkId; });
        if (!homework) {
          setSelectedHomeworkId(null);
          return null;
        }

        var checklistItems = homework.studentStatus.slice().sort(function(a, b) {
          return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
        }).map(function(s_status) {
          var student = activeClass.students.find(function(st) { return st.id === s_status.id; });
          if (!student) return null;

          return h("div", {
            key: student.id,
            className: "student-status-item homework-student-tile s-" + s_status.status,
            onClick: function() {
              updateClassState(activeClassId, function(cls) {
                var hw = cls.homeworks.find(function(h) { return h.id === selectedHomeworkId; });
                if (hw) {
                  var ss = hw.studentStatus.find(function(item) { return item.id === student.id; });
                  if (ss) {
                    var idx = STATUS_ORDER.indexOf(ss.status);
                    ss.status = STATUS_ORDER[(idx + 1) % 4];
                  }
                }
              });
            }
          },
            h("div", { className: "homework-student-id" }, student.id),
            h("div", { className: "homework-student-name" }, student.name),
            h("div", { className: "homework-status-pill" }, STATUS_TEXT[s_status.status])
          );
        });
        var detailCounts = homework.studentStatus.reduce(function(acc, s) {
          acc[s.status] = (acc[s.status] || 0) + 1;
          return acc;
        }, { pending: 0, submitted: 0, needs_correction: 0, completed: 0 });
        var detailTotal = Math.max(1, homework.studentStatus.length);
        var detailDone = Math.round((detailCounts.completed || 0) / detailTotal * 100);

        return h("div", { className: "homework-page homework-detail-page" + (highContrastCorrection ? " high-contrast-correction" : "") },
          h("div", { className: "homework-actions-row" },
            h("button", { className: "btn", onClick: function() { setSelectedHomeworkId(null); } }, "◀ 返回作業清單"),
            h("div", {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "rgba(255, 255, 255, 0.6)",
                padding: "6px 14px",
                borderRadius: "14px",
                border: "1px solid rgba(111, 78, 55, 0.12)",
                marginRight: "auto"
              }
            },
              h("span", { style: { fontWeight: "900", fontSize: "0.9em", color: "var(--manager-accent-2)" } }, "📢 訂正加強顯示"),
              h(Toggle, { value: highContrastCorrection, onChange: toggleHighContrastCorrection })
            ),
            h("button", {
              className: "btn danger",
              onClick: function() {
                if (confirm("確定要永久刪除此項作業嗎？")) {
                  updateClassState(activeClassId, function(cls) {
                    cls.homeworks = cls.homeworks.filter(function(h) { return h.id !== selectedHomeworkId; });
                  });
                  setSelectedHomeworkId(null);
                }
              }
            }, "刪除此作業")
          ),
          h("section", { className: "cm-card homework-detail-hero" },
            h("div", null,
              h("div", { className: "cm-eyebrow" }, "HOMEWORK CHECK"),
              h("h2", null, homework.title),
              h("p", null, "點選學生卡片即可切換狀態：未繳交、已繳交、待訂正、已完成。")
            ),
            h("div", { className: "homework-progress-box" },
              h("strong", null, detailDone + "%"),
              h("span", null, "已完成"),
              h("div", { className: "homework-progress-track" }, h("i", { style: { width: detailDone + "%" } }))
            )
          ),
          h("div", { className: "homework-status-strip" },
            h("div", { className: "status-box status-pending" }, h("span", null, "未繳交"), h("strong", null, detailCounts.pending || 0)),
            h("div", { className: "status-box status-submitted" }, h("span", null, "已繳交"), h("strong", null, detailCounts.submitted || 0)),
            h("div", { className: "status-box status-correction" }, h("span", null, "待訂正"), h("strong", null, detailCounts.needs_correction || 0)),
            h("div", { className: "status-box status-completed" }, h("span", null, "已完成"), h("strong", null, detailCounts.completed || 0))
          ),
          h("div", { className: "homework-student-grid" },
            checklistItems
          )
        );
      }

      /* Case 2: Homework list grid view */
      var sortedHomeworks = getSortedHomeworks(activeClass.homeworks);
      var hwCards = sortedHomeworks.map(function(hw) {
        var counts = hw.studentStatus.reduce(function(acc, s) {
          acc[s.status] = (acc[s.status] || 0) + 1;
          return acc;
        }, { pending: 0, submitted: 0, needs_correction: 0, completed: 0 });
        var total = Math.max(1, hw.studentStatus.length);
        var donePercent = Math.round((counts.completed || 0) / total * 100);
        var activeIssues = (counts.pending || 0) + (counts.needs_correction || 0);

        return h("button", {
          key: hw.id,
          className: "cm-card homework-card",
          onClick: function() { setSelectedHomeworkId(hw.id); }
        },
          h("div", { className: "homework-card-top" },
            h("span", { className: "homework-card-date" }, hw.date || "未標日期"),
            h("span", { className: "homework-card-alert " + (activeIssues ? "has-issues" : "is-clear") }, activeIssues ? activeIssues + " 待處理" : "全數完成")
          ),
          h("h3", null, hw.title),
          h("div", { className: "homework-progress-track" }, h("i", { style: { width: donePercent + "%" } })),
          h("div", { className: "homework-card-footer" },
            h("span", null, "完成 " + donePercent + "%"),
            h("span", null, "共 " + hw.studentStatus.length + " 人")
          ),
          h("div", { className: "status-summary" },
            h("div", { className: "status-box status-pending" }, h("span", null, "未繳交"), h("strong", null, counts.pending || 0)),
            h("div", { className: "status-box status-submitted" }, h("span", null, "已繳交"), h("strong", null, counts.submitted || 0)),
            h("div", { className: "status-box status-correction" }, h("span", null, "待訂正"), h("strong", null, counts.needs_correction || 0)),
            h("div", { className: "status-box status-completed" }, h("span", null, "已完成"), h("strong", null, counts.completed || 0))
          )
        );
      });

      return h("div", { className: "homework-page" + (highContrastCorrection ? " high-contrast-correction" : "") },
        h("section", { className: "cm-card homework-hero" },
          h("div", null,
            h("div", { className: "cm-eyebrow" }, "HOMEWORK"),
            h("h2", null, "作業訂正"),
            h("p", null, "用清單追蹤未繳交、待訂正與完成狀態。")
          ),
          h("div", { className: "homework-actions-row" },
            h("div", {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "rgba(255, 255, 255, 0.6)",
                padding: "6px 14px",
                borderRadius: "14px",
                border: "1px solid rgba(111, 78, 55, 0.12)",
                marginRight: "auto"
              }
            },
              h("span", { style: { fontWeight: "900", fontSize: "0.9em", color: "var(--manager-accent-2)" } }, "📢 訂正加強顯示"),
              h(Toggle, { value: highContrastCorrection, onChange: toggleHighContrastCorrection })
            ),
            h("label", { className: "homework-sort-control" },
              h("span", null, "排序"),
              h("select", {
                value: homeworkSortMode,
                onChange: function(e) { setHomeworkSortMode(e.target.value); }
              },
                h("option", { value: "created-desc" }, "新增時間：新到舊"),
                h("option", { value: "created-asc" }, "新增時間：舊到新")
              )
            ),
            h("button", { className: "btn primary", onClick: function() { setTaskBoardIndex(0); setTaskBoardPresenting(false); setModalTask(true); } }, "互動任務板"),
          h("button", { className: "btn secondary", onClick: function() { setModalExport(true); } }, "匯出學生報告"),
            h("button", { className: "btn primary", onClick: function() { setModalHw(true); } }, "新增作業")
          )
        ),
        h("div", { id: "homework-grid" },
          hwCards.length > 0
            ? hwCards
            : h("div", { className: "cm-card homework-empty" },
                h("h3", null, "目前沒有作業"),
                h("p", null, "新增第一項作業後，就可以開始追蹤學生繳交與訂正狀態。"),
                h("button", { className: "btn primary", onClick: function() { setModalHw(true); } }, "新增作業")
              )
        )
      );
    };

    var renderGroupingContent = function() {
      if (!activeClass) return null;

      var unassignedChips = activeClass.students.filter(function(s) {
        return s.group === null || s.group === undefined || s.group > activeClass.groupCount;
      }).map(function(s) {
        return h("div", {
          key: s.id,
          className: "student-chip",
          draggable: true,
          onDragStart: function(e) {
            e.dataTransfer.setData("text/plain", s.id);
          }
        }, s.id + ". " + s.name);
      });

      var groupColumns = Array.from({ length: activeClass.groupCount || 4 }, function(_, idx) {
        var gId = idx + 1;
        var groupItem = activeClass.groups.find(function(g) { return g.id === gId; }) || { id: gId, score: 0 };
        var members = activeClass.students.filter(function(s) { return s.group === gId; }).map(function(s) {
          return h("div", {
            key: s.id,
            className: "student-chip",
            draggable: true,
            onDragStart: function(e) {
              e.dataTransfer.setData("text/plain", s.id);
            }
          }, s.id + ". " + s.name);
        });

        return h("div", {
          key: gId,
          className: "card group-column",
          "data-group-id": gId,
          onDragOver: function(e) { e.preventDefault(); },
          onDrop: function(e) {
            var studentId = e.dataTransfer.getData("text/plain");
            updateClassState(activeClassId, function(cls) {
              var s = cls.students.find(function(item) { return item.id === studentId; });
              if (s) s.group = gId;
            });
          }
        },
          h("div", { className: "group-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            h("h3", { style: { margin: 0 } }, "第 " + gId + " 組"),
            h("div", { className: "score-controls", style: { display: "flex", gap: "4px" } },
              h("button", { className: "btn danger score-btn group-personal", title: "組員各扣1分", onClick: function(e) { handleGroupPersonalScoreUpdate(e, gId, -1); } }, "-"),
              h("button", { className: "btn score-btn group-personal", style: { background: "#24b243", color: "#fff" }, title: "組員各加1分", onClick: function(e) { handleGroupPersonalScoreUpdate(e, gId, 1); } }, "+"),
              h("button", { className: "btn score-btn group-competition", style: { background: "var(--manager-warm)", color: "#fff" }, title: "小組競賽加分", onClick: function(e) { handleGroupCompetitionScoreUpdate(e, gId, 1); } }, "🏆")
            )
          ),
          h("div", { className: "group-competition-score-display", style: { fontSize: "11px", color: "var(--manager-muted)", margin: "4px 0 8px 0" } },
            "小組分數: " + groupItem.score
          ),
          h("div", { className: "group-members", style: { minHeight: "150px" } }, members)
        );
      });

      return h("div", null,
        h("div", { className: "tab-actions", style: { display: "flex", gap: "14px", alignItems: "center", marginBottom: "16px" } },
          h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
            h("label", { style: { fontSize: "14px", fontWeight: "bold" } }, "小組數量:"),
            h("input", {
              type: "number",
              value: activeClass.groupCount || 4,
              onChange: function(e) { handleGroupCountChange(e.target.value); },
              style: { width: "70px", padding: "6px", borderRadius: "8px", border: "1px solid var(--manager-line)", background: "rgba(255,255,255,0.7)" }
            })
          ),
          h("button", {
            className: "btn primary",
            style: { marginLeft: "auto", background: "var(--manager-warm)" },
            onClick: function() { setModalPodium(true); }
          }, "🏆 小組積分榜"),
          h("button", {
            className: "btn primary",
            onClick: handleRandomGrouping
          }, "隨機打散分組")
        ),
        h("div", { className: "group-container" },
          h("div", {
            id: "unassigned-students-column",
            className: "card group-column",
            onDragOver: function(e) { e.preventDefault(); },
            onDrop: function(e) {
              var studentId = e.dataTransfer.getData("text/plain");
              updateClassState(activeClassId, function(cls) {
                var s = cls.students.find(function(item) { return item.id === studentId; });
                if (s) s.group = null;
              });
            }
          },
            h("h3", { style: { marginTop: 0 } }, "未分組"),
            h("div", { className: "group-members", style: { minHeight: "200px" } }, unassignedChips)
          ),
          h("div", { className: "groups-area", style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" } }, groupColumns)
        )
      );
    };

    var renderClassPickerModal = function() {
      if (!modalClassPicker) return null;
      return h("div", { className: "modal-backdrop visible" },
        h("div", { className: "cm-glass modal-card class-picker-modal" },
          h("div", { className: "modal-header modal-title-row" },
            h("div", null,
              h("div", { className: "cm-eyebrow" }, "選擇班級"),
              h("h2", { className: "modal-title" }, "今天要使用哪一班？")
            ),
            h("button", { className: "cm-button", onClick: function() { setModalClassPicker(false); } }, "關閉")
          ),
          h("div", { className: "class-switcher-list" },
            data.classes.length ? data.classes.map(function(cls) {
              var isCurrent = activeClass && cls.id === activeClass.id;
              return h("article", { key: cls.id, className: "class-switcher-card " + (isCurrent ? "is-current" : "") },
                h("div", null,
                  h("strong", null, cls.name),
                  h("span", null, cls.students.length + " 位學生 · 待辦 " + getIncompleteCount(cls))
                ),
                h("div", { className: "class-switcher-actions" },
                  h("button", {
                    className: "cm-button " + (isCurrent ? "cm-primary" : "cm-secondary"),
                    onClick: function() { selectClass(cls.id, true); }
                  }, isCurrent ? "目前班級" : "使用這班"),
                  h("button", {
                    className: "cm-button",
                    onClick: function() {
                      setModalClassPicker(false);
                      setModalClass({ open: true, classId: cls.id });
                    }
                  }, "編輯")
                )
              );
            }) : h("div", { className: "cm-empty empty-state" },
              h("div", null,
                h("h3", null, "尚未建立班級"),
                h("p", null, "請先建立第一個班級，才能開始使用工作台。")
              )
            )
          ),
          h("div", { className: "modal-actions modal-footer-actions" },
            h("button", {
              className: "cm-button cm-primary",
              onClick: function() {
                setModalClassPicker(false);
                setModalClass({ open: true, classId: null });
              }
            }, "新增班級")
          )
        )
      );
    };

    var renderSettingsModal = function() {
      if (!modalSettings) return null;
      var info = ClassManager.getStorageInfo ? ClassManager.getStorageInfo() : { bytes: 0, percent: 0, blackboardKeepDays: 90, examHistoryLimit: 50 };
      var legacy = data.legacyImports || {};
      var hasLegacyBlackboard = legacy.blackboard && activeClass;
      var cloudDraftMeta = getCloudDraftMeta();
      return h("div", { className: "modal-backdrop visible" },
        h("div", { className: "cm-glass modal-card settings-modal" },
          h("div", { className: "modal-header modal-title-row" },
            h("div", null,
              h("div", { className: "cm-eyebrow" }, "設定"),
              h("h2", { className: "modal-title" }, "班級管理設定")
            ),
            h("button", { className: "cm-button", onClick: function() { setModalSettings(false); } }, "關閉")
          ),
          h("section", { className: "settings-section" },
            h("h3", null, "班級與備份"),
            h("div", { className: "settings-actions-grid" },
              h("button", {
                className: "cm-button cm-primary",
                onClick: function() {
                  setModalSettings(false);
                  setModalClass({ open: true, classId: null });
                }
              }, "新增班級"),
              activeClass && h("button", {
                className: "cm-button cm-secondary",
                onClick: function() {
                  setModalSettings(false);
                  setModalClass({ open: true, classId: activeClass.id });
                }
              }, "編輯目前班級"),
              h("button", { className: "cm-button cm-secondary", onClick: handleBackupExport }, "匯出本機資料"),
              h("label", { className: "cm-button cm-secondary settings-file-button" },
                "載入備份檔案",
                h("input", { type: "file", accept: ".json", onChange: handleBackupImport })
              )
            )
          ),
          h("section", { className: "settings-section" },
            h("h3", null, "雲端資料預留"),
            h("p", null, "目前先用壓縮草稿模擬 Firebase 的上傳與下載；等專案建立後，只需把這裡的草稿來源改成雲端文件。"),
            h("div", { className: "settings-actions-grid" },
              h("button", {
                className: "cm-button cm-primary",
                disabled: cloudSaving || (getCloudSaveUsage().count || 0) >= CLOUD_DAILY_LIMIT,
                onClick: handleCloudDraftSave
              }, cloudSaving ? "壓縮中..." : "儲存資料"),
              h("button", {
                className: "cm-button cm-secondary",
                disabled: cloudRestoring,
                onClick: handleCloudDraftRestore
              }, cloudRestoring ? "載入中..." : "載入雲端資料")
            ),
            h("div", { className: "cloud-save-meta settings-cloud-meta" },
              cloudDraftMeta
                ? "可載入資料：" + new Date(cloudDraftMeta.savedAt).toLocaleString("zh-TW") + " · " +
                  formatStorageSize(cloudDraftMeta.compressedSize || 0) + " / " + formatStorageSize(cloudDraftMeta.originalSize || 0)
                : "尚無可載入資料。請先儲存一次。"
            )
          ),
          h("section", { className: "settings-section" },
            h("h3", null, "本機儲存"),
            h("div", { className: "storage-card" },
              h("div", { className: "storage-row" },
                h("span", null, "目前使用"),
                h("strong", null, formatStorageSize(info.bytes))
              ),
              h("div", { className: "storage-meter" },
                h("span", { style: { width: Math.min(100, info.percent || 0) + "%" } })
              ),
              h("p", null, "系統會自動保留最近 " + info.blackboardKeepDays + " 天黑板內容與最近 " + info.examHistoryLimit + " 筆考試紀錄；學生、分組與作業訂正不會自動刪除。"),
              h("button", {
                className: "cm-button cm-primary",
                onClick: function() {
                  var cleaned = ClassManager.cleanup();
                  setData(cleaned);
                  setActiveClassId(cleaned.currentClassId || (cleaned.classes[0] && cleaned.classes[0].id) || null);
                  alert("已整理本機資料。正式班級、學生與作業訂正資料不會被刪除。");
                }
              }, "立即整理本機資料")
            )
          ),
          hasLegacyBlackboard && h("section", { className: "settings-section" },
            h("h3", null, "舊資料"),
            h("p", null, "偵測到舊版黑板資料，可套用到目前班級。"),
            h("button", { className: "cm-button cm-secondary", onClick: handleApplyLegacyBlackboard }, "套用舊黑板到目前班級")
          )
        )
      );
    };

    /* ─── Global Modals Rendering ─── */
    var renderModals = function() {
      var editingClass = modalClass.classId
        ? data.classes.find(function(cls) { return cls.id === modalClass.classId; })
        : null;
      return h(React.Fragment, null,
        renderClassPickerModal(),
        renderSettingsModal(),
        /* 1. Class Add/Edit Modal */
        modalClass.open && h("div", { className: "modal-backdrop visible" },
          h("div", { className: "cm-glass modal-card" },
            h("h2", { className: "modal-title" }, modalClass.classId ? "編輯班級" : "新增班級"),
            h("form", {
              onSubmit: function(e) {
                e.preventDefault();
                var name = e.target.elements.className.value.trim();
                var list = e.target.elements.studentList.value.trim();
                if (!name || !list) {
                  alert("班級名稱和名單不能為空！");
                  return;
                }
                if (modalClass.classId) {
                  var parsed = ClassManager.parseStudents(list);
                  updateClassState(modalClass.classId, function(cls) {
                    var prev = cls.students || [];
                    cls.name = name;
                    cls.students = parsed.map(function(ns) {
                      var es = prev.find(function(item) { return String(item.id) === String(ns.id); });
                      return Object.assign({ score: 0, group: null, grade: null, tags: [] }, es || {}, {
                        id: String(ns.id),
                        name: ns.name
                      });
                    });
                    cls.homeworks.forEach(function(hw) {
                      var statusMap = new Map((hw.studentStatus || []).map(function(item) { return [String(item.id), item.status]; }));
                      hw.studentStatus = cls.students.map(function(st) {
                        return { id: st.id, status: statusMap.get(String(st.id)) || "pending" };
                      });
                    });
                    if (cls.quickGrouping) {
                      cls.quickGrouping.names = cls.students.map(function(s) { return s.name; });
                    }
                  });
                } else {
                  var newCls;
                  try {
                    newCls = ClassManager.createClass(name, list);
                  } catch (err) {
                    console.warn("Create class failed, trying emergency cleanup:", err);
                    try {
                      if (ClassManager.emergencyCleanup) ClassManager.emergencyCleanup();
                      newCls = ClassManager.createClass(name, list);
                    } catch (secondErr) {
                      console.error("Unable to create class:", secondErr);
                      var info = ClassManager.getStorageInfo ? ClassManager.getStorageInfo() : null;
                      var sizeText = info ? "目前 classManager_v1 約 " + formatStorageSize(info.bytes) + "。" : "";
                      alert("仍然無法新增班級。本機瀏覽器儲存空間可能已滿。" + sizeText + "請先到設定匯出備份，按「立即整理本機資料」後再試一次。");
                      return;
                    }
                  }
                  setActiveClassId(newCls.id);
                  setView("overview");
                }
                setData(ClassManager.load());
                setModalSettings(false);
                setModalClassPicker(false);
                setModalClass({ open: false, classId: null });
              }
            },
              h("div", { className: "field" },
                h("label", { htmlFor: "class-name-input" }, "班級名稱"),
                h("input", { id: "class-name-input", name: "className", defaultValue: editingClass ? editingClass.name : "", placeholder: "例如：三年一班" })
              ),
              h("div", { className: "field" },
                h("label", { htmlFor: "student-list-input" }, "學生名單"),
                h("textarea", {
                  id: "student-list-input",
                  name: "studentList",
                  rows: 8,
                  placeholder: "輸入人數 (例如 28)；\n或者貼上學生座號姓名，例如：\n1 王小明\n2 陳大華",
                  defaultValue: editingClass ? editingClass.students.map(function(s) { return s.id + " " + s.name; }).join("\n") : ""
                })
              ),
              h("div", { className: "modal-actions", style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" } },
                modalClass.classId && h("button", {
                  type: "button",
                  className: "cm-button btn danger",
                  style: { marginRight: "auto" },
                  onClick: function() {
                    if (confirm("確定要永久刪除此班級嗎？此動作將清除所有學生與作業紀錄。")) {
                      ClassManager.deleteClass(modalClass.classId);
                      var nextData = ClassManager.load();
                      setData(nextData);
                      setActiveClassId(nextData.currentClassId || (nextData.classes[0] ? nextData.classes[0].id : null));
                      setView("overview");
                      setModalClass({ open: false, classId: null });
                    }
                  }
                }, "刪除班級"),
                !(modalClass.onboarding && data.classes.length === 0) && h("button", { type: "button", className: "cm-button btn", onClick: function() { setModalClass({ open: false, classId: null }); } }, "取消"),
                h("button", { type: "submit", className: "cm-button cm-primary btn primary" }, "儲存變更")
              )
            )
          )
        ),

        /* 2. Student Add/Edit Modal */
        modalStudent.open && h("div", { className: "modal-backdrop visible" },
          h("div", { className: "cm-glass modal-card" },
            h("h2", { className: "modal-title" }, modalStudent.studentId ? "編輯學生" : "新增學生"),
            h("form", {
              onSubmit: function(e) {
                e.preventDefault();
                var id = e.target.elements.studentId.value.trim();
                var name = e.target.elements.studentName.value.trim();
                if (!id || !name) {
                  alert("座號和姓名不能為空！");
                  return;
                }
                updateClassState(activeClassId, function(cls) {
                  if (modalStudent.studentId) {
                    var s = cls.students.find(function(item) { return item.id === modalStudent.studentId; });
                    if (s) s.name = name;
                  } else {
                    if (cls.students.some(function(item) { return item.id === id; })) {
                      alert("座號重複！");
                      return;
                    }
                    cls.students.push({ id: id, name: name, score: 0, group: null, grade: null });
                    cls.homeworks.forEach(function(hw) {
                      hw.studentStatus.push({ id: id, status: "pending" });
                    });
                  }
                });
                setModalStudent({ open: false, studentId: null });
              }
            },
              h("div", { className: "field" },
                h("label", { htmlFor: "student-id-input" }, "座號"),
                h("input", {
                  id: "student-id-input",
                  name: "studentId",
                  defaultValue: modalStudent.studentId || "",
                  disabled: !!modalStudent.studentId,
                  placeholder: "輸入座號"
                })
              ),
              h("div", { className: "field" },
                h("label", { htmlFor: "student-name-input" }, "學生姓名"),
                h("input", {
                  id: "student-name-input",
                  name: "studentName",
                  defaultValue: modalStudent.studentId ? (function() {
                    var s = activeClass.students.find(function(item) { return item.id === modalStudent.studentId; });
                    return s ? s.name : "";
                  })() : "",
                  placeholder: "輸入姓名"
                })
              ),
              h("div", { className: "modal-actions", style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" } },
                modalStudent.studentId && h("button", {
                  type: "button",
                  className: "cm-button btn danger",
                  style: { marginRight: "auto" },
                  onClick: function() {
                    if (confirm("確定刪除此學生嗎？其成績與作業紀錄將被抹除。")) {
                      updateClassState(activeClassId, function(cls) {
                        cls.students = cls.students.filter(function(st) { return st.id !== modalStudent.studentId; });
                        cls.homeworks.forEach(function(hw) {
                          hw.studentStatus = hw.studentStatus.filter(function(item) { return item.id !== modalStudent.studentId; });
                        });
                      });
                      setModalStudent({ open: false, studentId: null });
                    }
                  }
                }, "刪除學生"),
                h("button", { type: "button", className: "cm-button btn", onClick: function() { setModalStudent({ open: false, studentId: null }); } }, "取消"),
                h("button", { type: "submit", className: "cm-button cm-primary btn primary" }, "儲存")
              )
            )
          )
        ),

        /* 3. Homework Add Modal */
        modalHw && h("div", { className: "modal-backdrop visible" },
          h("div", { className: "cm-glass modal-card" },
            h("h2", { className: "modal-title" }, "新增作業項目"),
            h("form", {
              onSubmit: function(e) {
                e.preventDefault();
                var title = e.target.elements.hwTitle.value.trim();
                if (!title) return;
                updateClassState(activeClassId, function(cls) {
                  cls.homeworks.unshift({
                    id: "H" + Date.now(),
                    title: title,
                    createdAt: new Date().toISOString(),
                    date: new Date().toLocaleDateString("zh-TW"),
                    studentStatus: cls.students.map(function(s) { return { id: s.id, status: "pending" }; })
                  });
                });
                setModalHw(false);
              }
            },
              h("div", { className: "field" },
                h("label", { htmlFor: "homework-title-input" }, "作業名稱"),
                h("input", { id: "homework-title-input", name: "hwTitle", placeholder: "例如：數學習作 P.42-43" })
              ),
              h("div", { className: "modal-actions", style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" } },
                h("button", { type: "button", className: "cm-button btn", onClick: function() { setModalHw(false); } }, "取消"),
                h("button", { type: "submit", className: "cm-button cm-primary btn primary" }, "確認建立")
              )
            )
          )
        ),

        /* 4. Interactive Task Board Modal */
        modalTask && h("div", { className: "modal-backdrop visible" + (highContrastCorrection ? " high-contrast-correction-modal" : "") },
          h("div", { className: "cm-glass modal-card task-board-modal " + (taskBoardPresenting ? "is-presenting" : "") },
            h("div", { className: "modal-header task-board-header" },
              h("div", null,
                h("div", { className: "cm-eyebrow" }, "QUICK CHECK"),
                h("h2", null, "互動任務板"),
                h("p", null, taskBoardPresenting ? "播放模式一次顯示一項作業，只顯示座號；學生上台點座號即可完成。" : "投影給學生確認作業狀態。每項作業會顯示未繳交與未訂正座號。")
              ),
              h("div", { className: "task-board-header-actions" },
                h("button", {
                  className: "btn secondary",
                  onClick: function() {
                    setTaskBoardIndex(0);
                    setTaskBoardPresenting(!taskBoardPresenting);
                  }
                }, taskBoardPresenting ? "回到總覽" : "投影播放"),
                h("button", { className: "btn", onClick: function() { setTaskBoardPresenting(false); setModalTask(false); } }, "關閉")
              )
            ),
            taskBoardPresenting
              ? h("div", { className: "task-board-presentation" },
                  (function() {
                    var homeworks = getSortedHomeworks(activeClass.homeworks);
                    if (!homeworks.length) {
                      return h("div", { className: "task-board-empty" },
                        h("h3", null, "目前沒有作業"),
                        h("p", null, "新增作業後，這裡會顯示每一項作業的未繳交人數與名單。")
                      );
                    }
                    var maxIndex = homeworks.length - 1;
                    var currentIndex = Math.max(0, Math.min(taskBoardIndex, maxIndex));
                    var renderTaskCard = function(hw, idx) {
                      var sorted = hw.studentStatus.slice().sort(function(a, b) {
                        return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
                      });
                      var pending = sorted.filter(function(s) { return s.status === "pending"; });
                      var correction = sorted.filter(function(s) { return s.status === "needs_correction"; });
                      var remaining = pending.length + correction.length;
                      var markStudentDone = function(studentId) {
                        updateClassState(activeClassId, function(cls) {
                          var currentHw = cls.homeworks.find(function(h) { return h.id === hw.id; });
                          if (currentHw) {
                            var ss = currentHw.studentStatus.find(function(s) { return s.id === studentId; });
                            if (ss) ss.status = "completed";
                          }
                        });
                      };
                      var makeStudentChip = function(item, statusLabel) {
                        var sInfo = activeClass.students.find(function(st) { return st.id === item.id; });
                        if (!sInfo) return null;
                        return h("button", {
                          key: item.id,
                          className: "student-task-chip is-seat-only " + (item.status === "pending" ? "is-pending" : "is-correction"),
                          title: sInfo.id + "號 " + sInfo.name + "：" + statusLabel,
                          "aria-label": sInfo.id + "號 " + sInfo.name + "：" + statusLabel + "，點擊標記完成",
                          onClick: function() {
                            markStudentDone(sInfo.id);
                          }
                        },
                          h("span", { className: "task-student-seat" }, sInfo.id)
                        );
                      };
                      var pendingChips = pending.map(function(item) { return makeStudentChip(item, "未繳交"); });
                      var correctionChips = correction.map(function(item) { return makeStudentChip(item, "未訂正"); });
                      return h("div", { className: "cm-card task-board-item task-board-slide " + (remaining === 0 ? "is-all-clear" : "") },
                        h("div", { className: "task-board-item-head" },
                          h("div", null,
                            h("small", null, "第 " + (idx + 1) + " / " + homeworks.length + " 項作業"),
                            h("h3", null, hw.title),
                            h("small", null, hw.date || "未標日期")
                          ),
                          h("div", { className: "task-board-total " + (remaining ? "has-remaining" : "is-clear") },
                            h("strong", null, remaining),
                            h("span", null, "人需處理")
                          )
                        ),
                        h("div", { className: "task-board-columns" },
                          h("section", { className: "task-status-column pending-column" },
                            h("div", { className: "task-column-head" },
                              h("strong", null, "未繳交"),
                              h("span", null, pending.length + " 人")
                            ),
                            h("div", { className: "task-student-list" },
                              pendingChips.length ? pendingChips : h("div", { className: "task-empty-list" }, "無")
                            )
                          ),
                        h("section", { className: "task-status-column correction-column" },
                            h("div", { className: "task-column-head" },
                              h("strong", null, "未訂正"),
                              h("span", null, correction.length + " 人")
                            ),
                            h("div", { className: "task-student-list" },
                              correctionChips.length ? correctionChips : h("div", { className: "task-empty-list" }, "無")
                            )
                          )
                        ),
                        remaining === 0 && h("div", { className: "task-clear-banner" }, "全班已完成")
                      );
                    };
                    return h(React.Fragment, null,
                      h("div", { className: "task-presentation-controls" },
                        h("button", {
                          className: "btn secondary",
                          disabled: currentIndex === 0,
                          onClick: function() { setTaskBoardIndex(Math.max(0, currentIndex - 1)); }
                        }, "上一項"),
                        h("div", { className: "task-presentation-count" }, (currentIndex + 1) + " / " + homeworks.length),
                        h("button", {
                          className: "btn secondary",
                          disabled: currentIndex === maxIndex,
                          onClick: function() { setTaskBoardIndex(Math.min(maxIndex, currentIndex + 1)); }
                        }, "下一項")
                      ),
                      renderTaskCard(homeworks[currentIndex], currentIndex)
                    );
                  })()
                )
              : h("div", { className: "task-board-grid" },
              (function() {
                var list = getSortedHomeworks(activeClass.homeworks).map(function(hw) {
                  var sorted = hw.studentStatus.slice().sort(function(a, b) {
                    return (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0);
                  });
                  var pending = sorted.filter(function(s) { return s.status === "pending"; });
                  var correction = sorted.filter(function(s) { return s.status === "needs_correction"; });
                  var remaining = pending.length + correction.length;
                  var markStudentDone = function(studentId) {
                    updateClassState(activeClassId, function(cls) {
                      var currentHw = cls.homeworks.find(function(h) { return h.id === hw.id; });
                      if (currentHw) {
                        var ss = currentHw.studentStatus.find(function(s) { return s.id === studentId; });
                        if (ss) ss.status = "completed";
                      }
                    });
                  };
                  var makeStudentChip = function(item, statusLabel) {
                    var sInfo = activeClass.students.find(function(st) { return st.id === item.id; });
                    if (!sInfo) return null;
                    return h("button", {
                      key: item.id,
                      className: "student-task-chip is-seat-only " + (item.status === "pending" ? "is-pending" : "is-correction"),
                      title: sInfo.id + "號 " + sInfo.name + "：" + statusLabel,
                      "aria-label": sInfo.id + "號 " + sInfo.name + "：" + statusLabel + "，點擊標記完成",
                      onClick: function() {
                        if (confirm(sInfo.name + " 已完成「" + hw.title + "」？")) {
                          markStudentDone(sInfo.id);
                        }
                      }
                    },
                      h("span", { className: "task-student-seat" }, sInfo.id)
                    );
                  };
                  var pendingChips = pending.map(function(item) { return makeStudentChip(item, "未繳交"); });
                      var correctionChips = correction.map(function(item) { return makeStudentChip(item, "未訂正"); });

                  return h("div", { key: hw.id, className: "cm-card task-board-item " + (remaining === 0 ? "is-all-clear" : "") },
                    h("div", { className: "task-board-item-head" },
                      h("div", null,
                        h("h3", null, hw.title),
                        h("small", null, hw.date || "未標日期")
                      ),
                      h("div", { className: "task-board-total " + (remaining ? "has-remaining" : "is-clear") },
                        h("strong", null, remaining),
                        h("span", null, "人需處理")
                      )
                    ),
                    h("div", { className: "task-board-columns" },
                      h("section", { className: "task-status-column pending-column" },
                        h("div", { className: "task-column-head" },
                          h("strong", null, "未繳交"),
                          h("span", null, pending.length + " 人")
                        ),
                        h("div", { className: "task-student-list" },
                          pendingChips.length ? pendingChips : h("div", { className: "task-empty-list" }, "無")
                        )
                      ),
                      h("section", { className: "task-status-column correction-column" },
                        h("div", { className: "task-column-head" },
                          h("strong", null, "未訂正"),
                          h("span", null, correction.length + " 人")
                        ),
                        h("div", { className: "task-student-list" },
                          correctionChips.length ? correctionChips : h("div", { className: "task-empty-list" }, "無")
                        )
                      )
                    ),
                    remaining === 0 && h("div", { className: "task-clear-banner" }, "全班已完成")
                  );
                });

                return list.length ? list : h("div", { className: "task-board-empty" },
                  h("h3", null, "目前沒有作業"),
                  h("p", null, "新增作業後，這裡會顯示每一項作業的未繳交人數與名單。")
                );
              })()
            )
          )
        ),

        /* 5. Student Report Export Modal */
        modalExport && h("div", { className: "modal-backdrop visible" },
          h("div", { className: "cm-glass modal-card" },
            h("h2", { className: "modal-title" }, "匯出個別學生報告"),
            h("div", { className: "field" },
              h("label", { htmlFor: "student-select" }, "選擇學生"),
              h("select", {
                id: "student-select",
                style: { padding: "8px", borderRadius: "8px", border: "1px solid var(--manager-line)", background: "rgba(255,255,255,0.7)" },
                onChange: function(e) {
                  var id = e.target.value;
                  var txtArea = document.getElementById("student-report-textarea");
                  if (!id) {
                    txtArea.value = "";
                    return;
                  }
                  var student = activeClass.students.find(function(s) { return s.id === id; });
                  var uncompleted = [];
                  activeClass.homeworks.forEach(function(hw) {
                    var status = hw.studentStatus.find(function(s) { return s.id === id; });
                    if (status && (status.status === "pending" || status.status === "needs_correction")) {
                      uncompleted.push("- " + hw.title + " (" + STATUS_TEXT[status.status] + ")");
                    }
                  });
                  txtArea.value = "【" + student.name + " 的作業未完成項目清單】\n\n" +
                    (uncompleted.length > 0 ? uncompleted.join("\n") : "🎉 恭喜，沒有任何未完成的作業項目！");
                }
              },
                h("option", { value: "" }, "-- 請選擇學生 --"),
                activeClass.students.map(function(s) {
                  return h("option", { key: s.id, value: s.id }, s.id + ". " + s.name);
                })
              )
            ),
            h("div", { className: "field" },
              h("label", null, "未繳交作業報告"),
              h("textarea", {
                id: "student-report-textarea",
                readOnly: true,
                rows: 6,
                style: { width: "100%", padding: "10px", borderRadius: "12px", border: "1px solid var(--manager-line)", background: "rgba(255,255,255,0.6)", fontFamily: "monospace" }
              })
            ),
            h("div", { className: "modal-actions", style: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" } },
              h("button", {
                className: "btn primary",
                style: { background: "#24b243" },
                onClick: function() {
                  var txtArea = document.getElementById("student-report-textarea");
                  if (txtArea && txtArea.value) {
                    txtArea.select();
                    document.execCommand("copy");
                    alert("報告已複製到剪貼簿！");
                  }
                }
              }, "複製報告"),
              h("button", { className: "btn", onClick: function() { setModalExport(false); } }, "關閉")
            )
          )
        ),

        /* 6. Podium Leaderboard Modal */
        modalPodium && h("div", { className: "modal-backdrop visible" },
          h("div", { className: "cm-glass modal-card", style: { width: "min(680px, 100%)" } },
            h("div", { className: "modal-header", style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" } },
              h("h2", { style: { margin: 0 } }, "🏆 小組積分儀表板"),
              h("button", { className: "btn", onClick: function() { setModalPodium(false); } }, "✕")
            ),
            h("div", { id: "group-ranking-podium" },
              (function() {
                var sorted = (activeClass.groups || []).slice().sort(function(a, b) { return b.score - a.score; });
                var stands = [];
                if (sorted[1]) stands.push(h("div", { key: "2nd", className: "podium-stand podium-2nd" }, h("h3", null, "🥈 第 " + sorted[1].id + " 組"), h("div", { className: "score" }, sorted[1].score)));
                if (sorted[0]) stands.push(h("div", { key: "1st", className: "podium-stand podium-1st" }, h("h3", null, "🥇 第 " + sorted[0].id + " 組"), h("div", { className: "score" }, sorted[0].score)));
                if (sorted[2]) stands.push(h("div", { key: "3rd", className: "podium-stand podium-3rd" }, h("h3", null, "🥉 第 " + sorted[2].id + " 組"), h("div", { className: "score" }, sorted[2].score)));
                return stands.length > 0 ? stands : h("p", { style: { color: "var(--manager-muted)", textAlign: "center" } }, "尚未設定小組或無積分資料。");
              })()
            )
          )
        )
      );
    };

    /* Stat values calculation for view headers */
    var totals = getTotals();

    var activeTitle = activeClass ? activeClass.name : "今天要做什麼？";
    var activeDesc = "先確認左側目前班級，再從下方大按鈕進入黑板、加分、作業、分組或考試計時。";
    if (!activeClass) {
      activeTitle = "建立第一個班級";
      activeDesc = "開始使用前，請先建立班級與學生名單。";
    } else if (currentView !== "overview") {
      activeTitle = activeClass.name;
      if (currentView === "blackboard") activeDesc = "直式注音黑板 • 提供自動拼音注音、聲調定位與英數字旋轉自動排版。";
      else if (currentView === "scoring") activeDesc = "班級加分與平時分數結算系統，支援組員積分連動。";
      else if (currentView === "homework") activeDesc = "追蹤學生作業訂正進度，包括未繳交、待訂正與已完成狀態。";
      else if (currentView === "grouping") activeDesc = "手動或隨機學生分組，支援組員點數與小組競賽點數調整。";
      else if (currentView === "tools") activeDesc = "綁定目前班級名單的抽籤與課堂倒數工具。";
      else if (currentView === "exam") activeDesc = "段考模式與課堂時間模式已整合在班級工作台內，不會開啟新分頁。";
    }

    return h("div", { className: "cm-app-shell manager-frame " + (sidebarCollapsed ? "is-sidebar-collapsed" : "") },
      /* Sidebar navigation panel */
      renderSidebar(),

      /* Workspace Panel */
      h("main", { className: "cm-main workspace" },
        /* Header Topbar */
        h("header", { className: "cm-topbar topbar" },
          h("div", null,
            h("div", { className: "cm-eyebrow eyebrow" }, "CLASSROOM HUB"),
            h("h1", { className: "cm-title page-title" }, activeTitle),
            h("p", { className: "cm-description page-desc" }, activeDesc)
          ),
          h("div", { className: "cm-topbar-actions topbar-actions" },
            currentView !== "overview" && activeClass && currentView === "scoring" && h("div", { className: "class-view-nav", style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              h("button", { className: "nav-tab btn " + (subTab === "personal" ? "active is-active" : ""), onClick: function() { setSubTab("personal"); } }, "個人計分"),
              h("button", { className: "nav-tab btn " + (subTab === "group" ? "active is-active" : ""), onClick: function() { setSubTab("group"); } }, "分組分數"),
              h("button", { className: "nav-tab btn " + (subTab === "grades" ? "active is-active" : ""), onClick: function() { setSubTab("grades"); } }, "成績結算")
            ),
            currentView !== "overview" && activeClass && currentView === "scoring" && h("button", {
              className: "cm-button cm-secondary",
              onClick: function() { setView("grouping"); }
            }, "前往分組模式"),
            currentView !== "overview" && activeClass && h("button", {
              className: "cm-button btn",
              onClick: function() { setModalClass({ open: true, classId: activeClass.id }); }
            }, "編輯班級名單"),
            currentView !== "overview" && activeClass && h("button", {
              className: "cm-button cm-exam-mode",
              onClick: function() { setView("exam"); setExamBoardOpen(false); }
            }, "一鍵考試模式")
          )
        ),

        /* Main View Workspace Content Router */
        h("section", { className: "cm-content content-grid" },
          (function() {
            if (currentView === "overview") return renderOverviewContent(totals);
            if (currentView === "blackboard") return renderBlackboardContent();
            if (currentView === "scoring") return renderScoringContent();
            if (currentView === "homework") return renderHomeworkContent();
            if (currentView === "grouping") return renderGroupingContent();
            if (currentView === "tools") return renderToolsContent();
            if (currentView === "exam") return renderExamContent();
            return null;
          })()
        )
      ),

      /* Conditionally Render Modals */
      renderModals()
    );
  }

  /* Mount to #app element */
  ReactDOM.createRoot(document.getElementById("app")).render(h(App));
})();
