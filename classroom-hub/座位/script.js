document.addEventListener('DOMContentLoaded', () => {
    const activeClass = window.ClassManager ? ClassManager.getActiveClass() : null;
    const defaultState = {
        currentStep: 1, students: [], seatingMode: 'individual', groups: [], rules: [],
        layout: { individualStyle: 'traditional', groupStyle: 'pod', rows: 5, cols: 6, },
        seatMap: {}, customTags: ['需要協助', '活潑'],
        tagColors: ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd', '#ff9ff3', '#00d2d3']
    };
    let appState = JSON.parse(JSON.stringify(defaultState));

    const DOMElements = {
        individualLayoutOptions: document.getElementById('individual-layout-options'), groupLayoutOptions: document.getElementById('group-layout-options'), traditionalSettings: document.getElementById('traditional-layout-settings'), panel: document.getElementById("controls-panel"), steps: document.querySelectorAll(".step"), backBtn: document.getElementById("back-btn"), nextBtn: document.getElementById("next-btn"), studentListInput: document.getElementById("student-list-input"), studentCountInput: document.getElementById("student-count-input"), generateByCountBtn: document.getElementById("generate-by-count-btn"), confirmStudentsBtn: document.getElementById("confirm-students-btn"), pendingStudentList: document.getElementById("pending-student-list"), pendingStudentCount: document.getElementById("pending-student-count"), modeBtns: document.querySelectorAll(".mode-btn"), groupModeSettings: document.getElementById("group-mode-settings"), individualModeSettings: document.getElementById("individual-mode-settings"), groupCountInput: document.getElementById("group-count-input"), autoGroupBtn: document.getElementById("auto-group-btn"), groupSetupArea: document.getElementById("group-setup-area"), studentTaggingList: document.getElementById("student-tagging-list"), generateSeatingBtn: document.getElementById("generate-seating-btn"), rowsInput: document.getElementById("rows-input"), colsInput: document.getElementById("cols-input"), seatMap: document.getElementById("seat-map"), exportBtn: document.getElementById("export-btn"), tagModal: document.getElementById("tag-modal"), tagModalStudentName: document.getElementById("tag-modal-student-name"), tagOptions: document.getElementById("tag-options"), customTagInput: document.getElementById("custom-tag-input"), addCustomTagBtn: document.getElementById("add-custom-tag-btn"), closeModalBtn: document.querySelector(".modal .close-btn"),
        // UPDATED: Refactored rule engine elements
        groupRulesList: document.getElementById('group-rules-list'),
        addGroupRuleBtn: document.getElementById('add-group-rule-btn'),
        seatingRulesList: document.getElementById('seating-rules-list'),
        addSeatingRuleBtn: document.getElementById('add-seating-rule-btn')
    };

    function classStudentsForSeating(savedStudents = []) {
        if (!activeClass) return savedStudents;
        return activeClass.students.map((student, index) => {
            const existing = savedStudents.find(s => s.name === student.name) || savedStudents[index] || {};
            return { id: index + 1, name: student.name, tags: existing.tags || student.tags || [] };
        });
    }

    function renderClassContext() {
        const bar = document.getElementById('class-context-bar');
        if (!bar) return;
        if (!activeClass) {
            bar.innerHTML = `<a class="cm-button" href="../index.html">← 返回班級管理</a><div><div class="class-context-title cm-title">尚未選擇班級</div><div class="class-context-meta">請先從主頁選擇班級</div></div>`;
            return;
        }
        const classId = encodeURIComponent(activeClass.id);
        bar.innerHTML = `<a class="cm-button" href="../index.html">← 返回班級管理</a><div><div class="class-context-label cm-eyebrow">智慧座位</div><div class="class-context-title cm-title">${activeClass.name}</div><div class="class-context-meta">${activeClass.students.length} 位學生 · 本機儲存</div></div><nav class="cm-topbar-actions"><a class="cm-button" href="../班級經營動力站2.0/index.html?classId=${classId}">動力站</a><a class="cm-button" href="../黑板/index.html?classId=${classId}">黑板</a><a class="cm-button cm-primary" href="./index.html?classId=${classId}">座位</a><a class="cm-button" href="../分組系統/index.html?classId=${classId}">分組</a><a class="cm-button cm-exam-mode" href="../考試計時/index.html?classId=${classId}">考試</a></nav>`;
    }

    function saveState() {
        if (activeClass && window.ClassManager) {
            activeClass.seating = appState;
            ClassManager.upsertActiveClass(activeClass);
        } else {
            localStorage.setItem('seatingChartState_v10.9', JSON.stringify(appState));
        }
    }
    function loadState() {
        if (activeClass) {
            appState = Object.assign(JSON.parse(JSON.stringify(defaultState)), activeClass.seating || {});
            appState.students = classStudentsForSeating(appState.students || []);
            DOMElements.studentListInput.value = appState.students.map(s => s.name).join('\n');
            if (!appState.quickClassApplied) appState.currentStep = 2;
            appState.quickClassApplied = true;
            return;
        }
        const savedState = localStorage.getItem('seatingChartState_v10.9');
        if (savedState) appState = JSON.parse(savedState);
    }

    function render() {
        DOMElements.steps.forEach((s, i) => s.classList.toggle('active', i + 1 === appState.currentStep));
        DOMElements.backBtn.style.display = appState.currentStep > 1 ? 'inline-block' : 'none';
        DOMElements.nextBtn.style.display = appState.currentStep < 4 ? 'inline-block' : 'none';
        const isIndividual = appState.seatingMode === 'individual';
        DOMElements.individualLayoutOptions.style.display = isIndividual ? 'flex' : 'none';
        DOMElements.groupLayoutOptions.style.display = !isIndividual ? 'flex' : 'none';
        const showTraditionalSettings = (isIndividual && appState.layout.individualStyle === 'traditional');
        DOMElements.traditionalSettings.style.display = showTraditionalSettings ? 'flex' : 'none';
        const individualLayoutInput = document.querySelector(`input[name="individual_layout"][value="${appState.layout.individualStyle}"]`);
        if (individualLayoutInput) individualLayoutInput.checked = true;
        const groupLayoutInput = document.querySelector(`input[name="group_layout"][value="${appState.layout.groupStyle}"]`);
        if (groupLayoutInput) groupLayoutInput.checked = true;
        DOMElements.rowsInput.value = appState.layout.rows;
        DOMElements.colsInput.value = appState.layout.cols;
        switch (appState.currentStep) {
            case 1: renderPendingStudentList(); break;
            case 2: renderModeSelection(); break;
            case 3: renderStep3(); break;
        }
        renderSeatMapLayout();
        renderSeatingArrangement();
    }

    // --- UPDATED: renderStep3 now calls specific setup functions ---
    function renderStep3() {
        const isGroupMode = appState.seatingMode === 'group';
        DOMElements.groupModeSettings.classList.toggle('active', isGroupMode);
        DOMElements.individualModeSettings.classList.toggle('active', !isGroupMode);
        if (isGroupMode) {
            renderGroupSetup();
            renderRules('group');
            setupRuleBuilder('group');
        } else {
            renderStudentTaggingList();
            renderRules('seating');
            setupRuleBuilder('seating');
        }
    }
    
    // --- UPDATED: autoGroup is now rule-aware ---
    function autoGroup() {
        const groupCount = parseInt(DOMElements.groupCountInput.value, 10);
        if (groupCount < 2 || groupCount > appState.students.length) { alert('組數設定不合理！'); return; }

        let studentsToGroup = [...appState.students];
        const newGroups = Array.from({ length: groupCount }, () => []);
        
        const togetherRules = appState.rules.filter(r => r.type === 'group_together');
        const apartRules = appState.rules.filter(r => r.type === 'group_apart');
        const handledStudents = new Set();

        // 1. Handle "must group together" rules with highest priority
        togetherRules.forEach(rule => {
            if (handledStudents.has(rule.student1) || handledStudents.has(rule.student2)) return;
            const pair = [rule.student1, rule.student2];
            // Find the smallest group to place the pair
            const smallestGroup = newGroups.reduce((prev, curr) => (curr.length < prev.length ? curr : prev));
            smallestGroup.push(...pair);
            handledStudents.add(rule.student1);
            handledStudents.add(rule.student2);
        });

        studentsToGroup = studentsToGroup.filter(s => !handledStudents.has(s.id));
        shuffleArray(studentsToGroup);

        // 2. Distribute remaining students, considering "group apart" rules
        studentsToGroup.forEach(student => {
            const avoidList = new Set();
            apartRules.forEach(r => {
                if (r.student1 === student.id) avoidList.add(r.student2);
                if (r.student2 === student.id) avoidList.add(r.student1);
            });

            const sortedGroups = newGroups.map((group, index) => ({ group, index }))
                                        .sort((a, b) => a.group.length - b.group.length);

            let bestGroupIndex = -1;
            // Find the smallest, conflict-free group
            for (const { group, index } of sortedGroups) {
                const hasConflict = group.some(memberId => avoidList.has(memberId));
                if (!hasConflict) {
                    bestGroupIndex = index;
                    break;
                }
            }
            // If all groups have conflicts, just pick the smallest one
            if (bestGroupIndex === -1) {
                bestGroupIndex = sortedGroups[0].index;
            }
            
            newGroups[bestGroupIndex].push(student.id);
        });

        appState.groups = newGroups;
        renderGroupSetup();
        saveState();
    }

    // --- UPDATED: renderRules and setupRuleBuilder now accept a mode ---
    function renderRules(mode) {
        const isGroup = mode === 'group';
        const list = isGroup ? DOMElements.groupRulesList : DOMElements.seatingRulesList;
        const relevantRules = isGroup 
            ? appState.rules.filter(r => r.type === 'group_together' || r.type === 'group_apart')
            : appState.rules.filter(r => r.type === 'near' || r.type === 'far' || r.type === 'position');
        
        list.innerHTML = '';
        relevantRules.forEach(rule => {
            const item = document.createElement("div"); item.className = "rule-item"; let description = '';
            const student1Name = getStudentById(rule.student1)?.name;
            const student2Name = getStudentById(rule.student2)?.name;
            
            if (!student1Name || !student2Name && (rule.type !== 'position')) return;

            switch (rule.type) {
                case 'group_together': description = `<b>${student1Name}</b> 必須與 <b>${student2Name}</b> 同組`; break;
                case 'group_apart': description = `<b>${student1Name}</b> 不可與 <b>${student2Name}</b> 同組`; break;
                case 'near': description = `<b>${student1Name}</b> 座位應靠近 <b>${student2Name}</b>`; break;
                case 'far': description = `<b>${student1Name}</b> 座位應遠離 <b>${student2Name}</b>`; break;
                case 'position': description = `標籤為 <b>${rule.tag}</b> 的學生應安排在 <b>${rule.area}</b>`; break;
            }
            item.innerHTML = `<span>${description}</span><button data-id="${rule.id}">&times;</button>`;
            list.appendChild(item);
        });
    }

    function setupRuleBuilder(mode) {
        const isGroup = mode === 'group';
        const ruleTypeSelector = document.getElementById(isGroup ? 'group-rule-type' : 'seating-rule-type');
        const ruleOptionsContainer = document.getElementById(isGroup ? 'group-rule-options' : 'seating-rule-options');
        const studentOptions = appState.students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        const tagOptions = appState.customTags.map(t => `<option value="${t}">${t}</option>`).join('');
        
        const type = ruleTypeSelector.value;
        let html = '';
        if (type === 'near' || type === 'far' || type === 'group_together' || type === 'group_apart') {
            html = `<select>${studentOptions}</select><select>${studentOptions}</select>`;
        } else if (type === 'position') {
            html = `<select>${tagOptions}</select><select><option value="前排">前排</option><option value="後排">後排</option><option value="靠左">靠左</option><option value="靠右">靠右</option></select>`;
        }
        ruleOptionsContainer.innerHTML = html;
    }

    function addRule(mode) {
        const isGroup = mode === 'group';
        const ruleTypeSelector = document.getElementById(isGroup ? 'group-rule-type' : 'seating-rule-type');
        const ruleOptionsContainer = document.getElementById(isGroup ? 'group-rule-options' : 'seating-rule-options');
        const selects = ruleOptionsContainer.querySelectorAll('select');
        
        const type = ruleTypeSelector.value;
        const newRule = { id: Date.now(), type };

        if (type === 'near' || type === 'far' || type === 'group_together' || type === 'group_apart') {
            const student1 = parseInt(selects[0].value, 10);
            const student2 = parseInt(selects[1].value, 10);
            if (student1 === student2) return alert('不能選擇同一個學生！');
            newRule.student1 = student1;
            newRule.student2 = student2;
        } else if (type === 'position') {
            newRule.tag = selects[0].value;
            newRule.area = selects[1].value;
        }
        appState.rules.push(newRule);
        renderRules(mode);
    }
    
    // --- 以下為其他函數，大部分保持不變 ---
    function renderSeatingArrangement() { document.querySelectorAll(".seat").forEach(seat => { seat.innerHTML = ''; seat.classList.remove("occupied"); seat.draggable = false; }); if (Object.keys(appState.seatMap).length === 0) return; Object.entries(appState.seatMap).forEach(([seatId, studentId]) => { const seat = document.getElementById(seatId); if (seat && studentId !== null) { const student = getStudentById(studentId); seat.classList.add("occupied"); seat.draggable = true; const tagsHtml = student.tags.map(tag => { const color = getTagColor(tag); return `<span class="tag-dot" style="background-color: ${color};" title="${tag}"></span>`; }).join(''); seat.innerHTML = `<span class="student-name">${student.name}</span><div class="tags-display">${tagsHtml}</div>`; } }); }
    let draggedSeatId = null;
    DOMElements.seatMap.addEventListener('dragstart', e => { const seat = e.target.closest('.seat'); if (seat && seat.classList.contains('occupied')) { draggedSeatId = seat.id; setTimeout(() => seat.classList.add('dragging'), 0); } });
    DOMElements.seatMap.addEventListener('dragend', e => { const seat = e.target.closest('.seat'); if (seat) seat.classList.remove('dragging'); draggedSeatId = null; });
    DOMElements.seatMap.addEventListener('dragover', e => { e.preventDefault(); const targetSeat = e.target.closest('.seat'); document.querySelectorAll('.seat.drag-over').forEach(s => s.classList.remove('drag-over')); if (targetSeat && targetSeat.id !== draggedSeatId) { targetSeat.classList.add('drag-over'); } });
    DOMElements.seatMap.addEventListener('dragleave', e => { const targetSeat = e.target.closest('.seat'); if (targetSeat) { targetSeat.classList.remove('drag-over'); } });
    DOMElements.seatMap.addEventListener('drop', e => { e.preventDefault(); document.querySelectorAll('.seat.drag-over').forEach(s => s.classList.remove('drag-over')); const targetSeat = e.target.closest('.seat'); if (targetSeat && draggedSeatId && targetSeat.id !== draggedSeatId) { const targetSeatId = targetSeat.id; const sourceStudentId = appState.seatMap[draggedSeatId]; const targetStudentId = appState.seatMap[targetSeatId]; appState.seatMap[draggedSeatId] = targetStudentId; appState.seatMap[targetSeatId] = sourceStudentId; renderSeatingArrangement(); saveState(); } });
    function shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }
    function generateSeating() { const allSeats = Array.from(document.querySelectorAll('.seat')).filter(s => s.style.visibility !== 'hidden').map(s => ({ id: s.id, row: parseInt(s.dataset.row, 10), col: parseInt(s.dataset.col, 10), })); let unseatedStudents = [...appState.students]; shuffleArray(unseatedStudents); let seatMap = {}; allSeats.forEach(s => seatMap[s.id] = null); if (appState.seatingMode === 'group') { if (appState.layout.groupStyle === 'column') { appState.groups.forEach((group, c) => { const colSeats = allSeats.filter(s => s.col === c); group.forEach((studentId, i) => { if (colSeats[i]) { seatMap[colSeats[i].id] = studentId; unseatedStudents = unseatedStudents.filter(s => s.id !== studentId); } }); }); } else if (appState.layout.groupStyle === 'pod') { const groupPods = document.querySelectorAll('.group-pod'); appState.groups.forEach((group, i) => { if (groupPods[i]) { const podSeats = Array.from(groupPods[i].querySelectorAll('.seat')); group.forEach((studentId, studentIndex) => { if (podSeats[studentIndex]) { const seatId = podSeats[studentIndex].id; seatMap[seatId] = studentId; unseatedStudents = unseatedStudents.filter(s => s.id !== studentId); } }); } }); } } const positionRules = appState.rules.filter(r => "position" === r.type); positionRules.forEach(rule => { const studentsToPlace = unseatedStudents.filter(s => s.tags.includes(rule.tag)); studentsToPlace.forEach(student => { let bestSeat = findBestSeatForPosition(rule.area, allSeats.filter(s => null === seatMap[s.id])); if (bestSeat) { seatMap[bestSeat.id] = student.id; unseatedStudents = unseatedStudents.filter(s => s.id !== student.id); } }); }); unseatedStudents.forEach(student => { let bestSeatId = null, maxScore = -Infinity; const availableSeats = allSeats.filter(s => null === seatMap[s.id]); if (availableSeats.length === 0) return; availableSeats.forEach(seat => { let currentScore = 0; seatMap[seat.id] = student.id; appState.rules.forEach(rule => { if (("near" === rule.type || "group_together" === rule.type) && (rule.student1 === student.id || rule.student2 === student.id)) { const otherStudentId = rule.student1 === student.id ? rule.student2 : rule.student1; const otherStudentSeat = findSeatOfStudent(otherStudentId, seatMap, allSeats); if (otherStudentSeat && areSeatsAdjacent(seat, otherStudentSeat)) currentScore += 10; else if (otherStudentSeat) currentScore -= 5; } else if (("far" === rule.type || "group_apart" === rule.type) && (rule.student1 === student.id || rule.student2 === student.id)) { const otherStudentId = rule.student1 === student.id ? rule.student2 : rule.student1; const otherStudentSeat = findSeatOfStudent(otherStudentId, seatMap, allSeats); if (otherStudentSeat && !areSeatsAdjacent(seat, otherStudentSeat, 2)) currentScore += 10; else if (otherStudentSeat) currentScore -= 20; } }); seatMap[seat.id] = null; if (currentScore > maxScore) { maxScore = currentScore; bestSeatId = seat.id; } }); if (bestSeatId) { seatMap[bestSeatId] = student.id; } else { if (availableSeats.length > 0) seatMap[availableSeats[0].id] = student.id; } }); appState.seatMap = seatMap; renderSeatingArrangement(); saveState(); }
    function renderSeatMapLayout() { const map = DOMElements.seatMap; map.innerHTML = ''; map.style.cssText = 'display: grid; gap: 10px; position: relative;'; const isIndividual = appState.seatingMode === 'individual'; if (isIndividual) { if (appState.layout.individualStyle === 'traditional') { const { rows, cols } = appState.layout; map.style.gridTemplateColumns = `repeat(${cols}, 1fr)`; for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) createSeatElement(r, c); } } else if (appState.layout.individualStyle === 'neighbor_pairing') { const pairCount = Math.ceil(appState.students.length / 2); const gridCols = Math.ceil(Math.sqrt(pairCount * 1.5)); map.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`; for (let i = 0; i < pairCount; i++) { const pod = document.createElement('div'); pod.className = 'group-pod'; pod.style.display = 'grid'; pod.style.gridTemplateColumns = '1fr 1fr'; createSeatElement(Math.floor(i / gridCols), i % gridCols * 2, pod).id = `seat-p-${i}-0`; createSeatElement(Math.floor(i / gridCols), i % gridCols * 2 + 1, pod).id = `seat-p-${i}-1`; map.appendChild(pod); } } } else { if (appState.layout.groupStyle === 'pod') { const groupCount = appState.groups.length; if (groupCount === 0) return; const gridCols = Math.ceil(Math.sqrt(groupCount)); map.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`; appState.groups.forEach((group, i) => { const pod = document.createElement('div'); pod.className = 'group-pod'; pod.style.display = 'grid'; const members = group || []; const podCols = Math.ceil(Math.sqrt(members.length)) || 1; pod.style.gridTemplateColumns = `repeat(${podCols}, 1fr)`; for (let j = 0; j < members.length; j++) { createSeatElement(i, j, pod).id = `seat-g-${i}-${j}`; } map.appendChild(pod); }); } else if (appState.layout.groupStyle === 'column') { const groupCount = appState.groups.length; if (groupCount === 0) return; const maxGroupSize = Math.max(...appState.groups.map(g => g.length), 0); map.style.gridTemplateColumns = `repeat(${groupCount}, 1fr)`; for (let r = 0; r < maxGroupSize; r++) { for (let c = 0; c < groupCount; c++) { const seat = createSeatElement(r, c); if (r >= (appState.groups[c] || []).length) { seat.style.visibility = 'hidden'; } } } } } }
    function updateStep(newStep) { if (newStep > appState.currentStep) { if (appState.currentStep === 1 && appState.students.length === 0) { alert('請先建立學生名單！'); return; } if (appState.currentStep === 2 && !appState.seatingMode) { alert('請選擇排座模式！'); return; } } appState.currentStep = newStep; render(); saveState(); }
    function handleStudentInput() { const text = DOMElements.studentListInput.value; const names = text.split(/[\n,、\s]+/).filter(name => name.trim() !== ''); appState.students = names.map((name, index) => ({ id: index, name: name.trim(), tags: [] })); renderPendingStudentList(); }
    function generateStudentsByCount() { const count = parseInt(DOMElements.studentCountInput.value, 10); if (count > 0) { const names = Array.from({ length: count }, (_, i) => `${i + 1}號`); DOMElements.studentListInput.value = names.join('\n'); handleStudentInput(); } }
    function renderPendingStudentList() { const list = DOMElements.pendingStudentList; list.innerHTML = ''; appState.students.forEach(student => { const li = document.createElement('li'); li.className = 'student-list-item'; li.innerHTML = `<span class="student-name">${student.name}</span><div class="item-actions"><button class="delete-btn" data-id="${student.id}">刪除</button></div>`; list.appendChild(li); }); DOMElements.pendingStudentCount.innerText = appState.students.length; }
    DOMElements.pendingStudentList.addEventListener("click", e => { if (e.target.classList.contains("delete-btn")) { appState.students = appState.students.filter(s => s.id !== parseInt(e.target.dataset.id, 10)); render(); saveState(); } });
    function renderModeSelection() { DOMElements.modeBtns.forEach(btn => { btn.classList.toggle("selected", btn.dataset.mode === appState.seatingMode); }); }
    DOMElements.modeBtns.forEach(btn => { btn.addEventListener("click", () => { appState.seatingMode = btn.dataset.mode; render(); saveState(); }); });
    function renderGroupSetup() { const area = DOMElements.groupSetupArea; area.innerHTML = ''; const unassignedStudents = getUnassignedStudents(); const unassignedPool = createGroupBox('待安排學生', 'unassigned', unassignedStudents); unassignedPool.id = 'unassigned-pool'; area.appendChild(unassignedPool); const groupBoxesContainer = document.createElement('div'); groupBoxesContainer.id = 'group-boxes-container'; area.appendChild(groupBoxesContainer); const groupCount = parseInt(DOMElements.groupCountInput.value, 10); for (let i = 0; i < groupCount; i++) { const groupStudents = (appState.groups[i] || []).map(id => getStudentById(id)); const groupBox = createGroupBox(`第 ${i + 1} 組`, i, groupStudents); groupBoxesContainer.appendChild(groupBox); } }
    function createGroupBox(title, groupId, students) { const box = document.createElement("div"); box.className = "group-box"; box.dataset.groupId = groupId; box.innerHTML = `<h5>${title}</h5>`; students.forEach(student => { if (student) { const card = document.createElement("div"); card.className = "student-card"; card.textContent = student.name; card.dataset.studentId = student.id; card.draggable = true; box.appendChild(card); } }); return box; }
    function getUnassignedStudents() { const assignedIds = new Set(appState.groups.flat()); return appState.students.filter(s => !assignedIds.has(s.id)); }
    let groupDragStudentId = null;
    DOMElements.groupSetupArea.addEventListener("dragstart", e => { if (e.target.classList.contains("student-card")) { groupDragStudentId = parseInt(e.target.dataset.studentId, 10); e.target.classList.add("dragging"); } });
    DOMElements.groupSetupArea.addEventListener("dragend", e => { if (e.target.classList.contains("student-card")) e.target.classList.remove("dragging"); });
    DOMElements.groupSetupArea.addEventListener("dragover", e => { e.preventDefault(); const targetBox = e.target.closest(".group-box"); if (targetBox) { document.querySelectorAll('.group-box.drag-over').forEach(b => b.classList.remove('drag-over')); targetBox.classList.add('drag-over'); } });
    DOMElements.groupSetupArea.addEventListener("dragleave", e => { const targetBox = e.target.closest(".group-box"); if (targetBox) targetBox.classList.remove('drag-over'); });
    DOMElements.groupSetupArea.addEventListener("drop", e => { e.preventDefault(); document.querySelectorAll('.group-box.drag-over').forEach(b => b.classList.remove('drag-over')); const targetBox = e.target.closest(".group-box"); if (targetBox && groupDragStudentId !== null) { appState.groups.forEach((group, index) => { appState.groups[index] = group.filter(id => id !== groupDragStudentId); }); const targetGroupId = targetBox.dataset.groupId; if (targetGroupId !== "unassigned") { const groupIndex = parseInt(targetGroupId, 10); if (!appState.groups[groupIndex]) appState.groups[groupIndex] = []; appState.groups[groupIndex].push(groupDragStudentId); } groupDragStudentId = null; renderGroupSetup(); saveState(); } });
    function renderStudentTaggingList() { const list = DOMElements.studentTaggingList; list.innerHTML = "<h4>點擊學生以設定標籤</h4>"; appState.students.forEach(student => { const item = document.createElement("div"); item.className = "student-list-item"; item.dataset.studentId = student.id; const tagsHtml = student.tags.map(tag => { const color = getTagColor(tag); return `<span class="tag-dot" style="background-color: ${color};" title="${tag}"></span>`; }).join(""); item.innerHTML = `<span class="student-name">${student.name}</span><div class="tags-display">${tagsHtml}</div>`; list.appendChild(item); }); }
    DOMElements.studentTaggingList.addEventListener("click", e => { const item = e.target.closest(".student-list-item"); if (item) openTagModal(parseInt(item.dataset.studentId, 10)); });
    let currentTaggingStudentId = null;
    function openTagModal(studentId) { currentTaggingStudentId = studentId; const student = getStudentById(studentId); DOMElements.tagModalStudentName.textContent = `設定標籤：${student.name}`; renderTagOptions(); DOMElements.tagModal.style.display = "block"; }
    function renderTagOptions() { const optionsContainer = DOMElements.tagOptions; optionsContainer.innerHTML = ''; const student = getStudentById(currentTaggingStudentId); appState.customTags.forEach(tag => { const isChecked = student.tags.includes(tag); const label = document.createElement("label"); label.innerHTML = `<input type="checkbox" class="tag-checkbox" value="${tag}" ${isChecked ? "checked" : ""}> ${tag}`; optionsContainer.appendChild(label); }); }
    function addCustomTag() { const tagName = DOMElements.customTagInput.value.trim(); if (tagName && !appState.customTags.includes(tagName)) { appState.customTags.push(tagName); DOMElements.customTagInput.value = ""; renderTagOptions(); saveState(); } }
    function closeTagModal() { DOMElements.tagModal.style.display = "none"; currentTaggingStudentId = null; }
    DOMElements.tagOptions.addEventListener("change", e => { if (e.target.classList.contains("tag-checkbox") && currentTaggingStudentId !== null) { const student = getStudentById(currentTaggingStudentId); const tag = e.target.value; if (e.target.checked) { if (!student.tags.includes(tag)) student.tags.push(tag); } else { student.tags = student.tags.filter(t => t !== tag); } renderStudentTaggingList(); saveState(); } });
    function getTagColor(tag) { const index = appState.customTags.indexOf(tag); return appState.tagColors[index % appState.tagColors.length]; }
    DOMElements.groupRulesList.addEventListener("click", e => { if (e.target.tagName === "BUTTON") { appState.rules = appState.rules.filter(r => r.id !== parseInt(e.target.dataset.id, 10)); renderRules('group'); saveState(); } });
    DOMElements.seatingRulesList.addEventListener("click", e => { if (e.target.tagName === "BUTTON") { appState.rules = appState.rules.filter(r => r.id !== parseInt(e.target.dataset.id, 10)); renderRules('seating'); saveState(); } });
    function createSeatElement(r, c, parent = DOMElements.seatMap) { const seat = document.createElement('div'); seat.className = 'seat'; seat.dataset.row = r; seat.dataset.col = c; seat.id = `seat-${r}-${c}`; parent.appendChild(seat); return seat; }
    function findBestSeatForPosition(area, availableSeats) { if (availableSeats.length === 0) return null; const rows = [...new Set(availableSeats.map(s => s.row))].sort((a, b) => a - b); const cols = [...new Set(availableSeats.map(s => s.col))].sort((a, b) => a - b); let targetSeats = []; if (area === '前排' && rows.length > 0) targetSeats = availableSeats.filter(s => s.row === rows[0]); else if (area === '後排' && rows.length > 0) targetSeats = availableSeats.filter(s => s.row === rows[rows.length - 1]); else if (area === '靠左' && cols.length > 0) targetSeats = availableSeats.filter(s => s.col === cols[0]); else if (area === '靠右' && cols.length > 0) targetSeats = availableSeats.filter(s => s.col === cols[cols.length - 1]); return targetSeats.length > 0 ? targetSeats[0] : availableSeats[0]; }
    function findSeatOfStudent(studentId, currentMap, allSeats) { const seatId = Object.keys(currentMap).find(id => currentMap[id] === studentId); return seatId ? allSeats.find(s => s.id === seatId) : null; }
    function areSeatsAdjacent(seat1, seat2, distance = 1) { if (!seat1 || !seat2) return false; const rowDiff = Math.abs(seat1.row - seat2.row); const colDiff = Math.abs(seat1.col - seat2.col); return (rowDiff <= distance && colDiff <= distance) && (rowDiff + colDiff > 0); }
    function exportToHtml() { const mapHtml = DOMElements.seatMap.innerHTML; const cssText = DOMElements.seatMap.style.cssText; const newWindow = window.open(); newWindow.document.write(`<html><head><title>座位表</title><style>body { font-family: 'Noto Sans TC', sans-serif; } h1 { text-align: center; }.front-of-class { text-align: center; background: #795548; color: white; padding: 5px; border-radius: 5px; margin: 0 auto 20px auto; width: 200px; }#seat-map { border: 1px solid #ccc; padding: 20px; position: relative; height: 85vh; ${cssText} }.seat { box-sizing: border-box; border: 1px solid #333; border-radius: 5px; min-height: 60px; display: flex; align-items: center; justify-content: center; flex-direction: column; text-align: center; padding: 5px; background-color: white; }.student-name { font-weight: bold; } .tags-display { display: flex; gap: 3px; margin-top: 5px; }.tag-dot { width: 10px; height: 10px; border-radius: 50%; }.group-pod { display: grid; gap: 5px; border: 2px dashed #ccc; padding: 10px; border-radius: 10px; }.seat[style*="absolute"] { position: absolute; }</style></head><body><h1>座位表</h1><div class="front-of-class">講台</div><div id="seat-map">${mapHtml}</div><script>const tagColors = ${JSON.stringify(appState.tagColors)}; const customTags = ${JSON.stringify(appState.customTags)}; function getTagColor(tag) { const index = customTags.indexOf(tag); return tagColors[index % tagColors.length]; } document.querySelectorAll('.tag-dot').forEach(dot => { dot.style.backgroundColor = getTagColor(dot.title); }); setTimeout(() => { window.print(); window.close(); }, 500); <\/script></body></html>`); newWindow.document.close(); }
    function getStudentById(id) { return appState.students.find(s => s.id === id); }
    DOMElements.nextBtn.addEventListener("click", () => updateStep(appState.currentStep + 1));
    DOMElements.backBtn.addEventListener("click", () => updateStep(appState.currentStep - 1));
    DOMElements.confirmStudentsBtn.addEventListener("click", () => updateStep(2));
    DOMElements.studentListInput.addEventListener("input", handleStudentInput);
    DOMElements.generateByCountBtn.addEventListener("click", generateStudentsByCount);
    DOMElements.autoGroupBtn.addEventListener("click", autoGroup);
    DOMElements.addSeatingRuleBtn.addEventListener("click", () => addRule('seating'));
    DOMElements.addGroupRuleBtn.addEventListener("click", () => addRule('group'));
    document.getElementById('group-rule-type').addEventListener('change', () => setupRuleBuilder('group'));
    document.getElementById('seating-rule-type').addEventListener('change', () => setupRuleBuilder('seating'));
    DOMElements.addCustomTagBtn.addEventListener("click", addCustomTag);
    DOMElements.closeModalBtn.addEventListener("click", closeTagModal);
    window.addEventListener("click", e => { if (e.target == DOMElements.tagModal) closeTagModal(); });
    [DOMElements.rowsInput, DOMElements.colsInput].forEach(input => { input.addEventListener("change", () => { appState.layout.rows = parseInt(DOMElements.rowsInput.value, 10); appState.layout.cols = parseInt(DOMElements.colsInput.value, 10); render(); saveState(); }); });
    DOMElements.individualLayoutOptions.addEventListener('change', e => { appState.layout.individualStyle = e.target.value; render(); saveState(); });
    DOMElements.groupLayoutOptions.addEventListener('change', e => { appState.layout.groupStyle = e.target.value; render(); saveState(); });
    DOMElements.generateSeatingBtn.addEventListener("click", () => { renderSeatMapLayout(); setTimeout(generateSeating, 50); });
    DOMElements.exportBtn.addEventListener("click", exportToHtml);
    function init() {
        loadState();
        renderClassContext();
        particlesJS("particles-js", { particles: { number: { value: 120, density: { enable: true, value_area: 800 } }, color: { value: "#E87A5D" }, shape: { type: "circle" }, opacity: { value: 0.5, random: true, anim: { enable: false, speed: 1, opacity_min: 0.1, sync: false } }, size: { value: 3, random: true, anim: { enable: false } }, line_linked: { enable: true, distance: 150, color: "#795548", opacity: 0.2, width: 1 }, move: { enable: true, speed: 2, direction: "none", random: false, straight: false, out_mode: "out", bounce: false } }, interactivity: { detect_on: "canvas", events: { onhover: { enable: true, mode: "bubble" }, onclick: { enable: true, mode: "push" }, resize: true }, modes: { bubble: { distance: 200, size: 8, duration: 2, opacity: 0.8 }, push: { particles_nb: 4 } } }, retina_detect: true });
        render();
    }
    init();
});
