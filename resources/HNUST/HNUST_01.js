/**
 * 解析强智系统的周次字符串
 */
function parseWeeks(weekStr) {
    let weeks = [];
    let parts = weekStr.split(',');
    for (let part of parts) {
        if (part.includes('-')) {
            let [start, end] = part.split('-');
            for (let i = parseInt(start); i <= parseInt(end); i++) {
                if (!weeks.includes(i)) weeks.push(i);
            }
        } else {
            let w = parseInt(part);
            if (!isNaN(w) && !weeks.includes(w)) weeks.push(w);
        }
    }
    return weeks.sort((a, b) => a - b);
}

/**
 * 提取课程数据
 */
function extractCoursesFromDoc(doc) {
    let parsedCourses = [];
    const table = doc.getElementById('timetable');
    if (!table) throw new Error("请求成功但未找到课表表格，请确认教务系统状态。");

    const rows = table.getElementsByTagName('tr');
    for (let i = 1; i < rows.length - 1; i++) {
        const cells = rows[i].getElementsByTagName('td');
        for (let j = 0; j < cells.length; j++) {
            const dayOfWeek = j + 1; 
            const cell = cells[j];
            
            const detailDivs = cell.querySelectorAll('div.kbcontent');
            if (detailDivs.length === 0) continue;

            detailDivs.forEach(div => {
                let htmlContent = div.innerHTML;
                if (!htmlContent.trim() || htmlContent === '&nbsp;') return;

                let courseBlocks = htmlContent.split(/-{10,}\s*<br\s*\/?>/i);

                courseBlocks.forEach(block => {
                    if (!block.trim()) return;

                    let tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let courseObj = {
                        day: dayOfWeek,
                        isCustomTime: false
                    };

                    let firstNode = tempDiv.childNodes[0];
                    if (firstNode && firstNode.nodeType === Node.TEXT_NODE) {
                        courseObj.name = firstNode.nodeValue.trim();
                    } else {
                        courseObj.name = tempDiv.innerText.split('\n')[0].trim();
                    }

                    let teacherFont = tempDiv.querySelector('font[title="教师"]');
                    courseObj.teacher = teacherFont ? teacherFont.innerText.trim() : "未知";

                    let positionFont = tempDiv.querySelector('font[title="教室"]');
                    courseObj.position = positionFont ? positionFont.innerText.trim() : "待定";

                    let timeFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    if (timeFont) {
                        let timeText = timeFont.innerText.trim();
                        let timeMatch = timeText.match(/(.+?)\(周\)\[(\d+)-(\d+)节\]/);
                        if (timeMatch) {
                            courseObj.weeks = parseWeeks(timeMatch[1]);
                            courseObj.startSection = parseInt(timeMatch[2]);
                            courseObj.endSection = parseInt(timeMatch[3]);
                        } else {
                            let weekOnlyMatch = timeText.match(/(.+?)\(周\)/);
                            if (weekOnlyMatch) {
                                courseObj.weeks = parseWeeks(weekOnlyMatch[1]);
                                courseObj.startSection = i * 2 - 1;
                                courseObj.endSection = i * 2;
                            } else return; 
                        }
                    } else return; 

                    if (courseObj.name && courseObj.weeks && courseObj.weeks.length > 0) {
                        parsedCourses.push(courseObj);
                    }
                });
            });
        }
    }
    return parsedCourses;
}

/**
 * 生成作息时间段
 */
function getPresetTimeSlots() {
    return [
        { "number": 1, "startTime": "08:00", "endTime": "08:45" },
        { "number": 2, "startTime": "08:55", "endTime": "09:40" },
        { "number": 3, "startTime": "09:50", "endTime": "10:35" },
        { "number": 4, "startTime": "10:45", "endTime": "11:30" },
        { "number": 5, "startTime": "14:00", "endTime": "14:45" },
        { "number": 6, "startTime": "14:55", "endTime": "15:40" },
        { "number": 7, "startTime": "15:50", "endTime": "16:35" },
        { "number": 8, "startTime": "16:45", "endTime": "17:30" },
        { "number": 9, "startTime": "19:00", "endTime": "19:45" },
        { "number": 10,"startTime": "19:55", "endTime": "20:40" }
    ];
}

/**
 * 生成全局课表配置
 */
function getCourseConfig() {
    return {
        "defaultClassDuration": 45,
        "defaultBreakDuration": 10
    };
}

/**
 * 异步编排流程
 */
async function runImportFlow() {
    try {
        if (typeof window.AndroidBridge !== 'undefined') {
            AndroidBridge.showToast("正在获取课表数据，请稍候...");
        } else {
            console.log("正在发起请求获取课表...");
        }

        const response = await fetch('/jsxsd/xskb/xskb_list.do', { method: 'GET' });
        const htmlText = await response.text();
        const parser = new DOMParser();
        let doc = parser.parseFromString(htmlText, 'text/html');

        const selectElem = doc.getElementById('xnxq01id');
        let semesters = [];
        let semesterValues = [];
        let defaultIndex = 0;

        if (selectElem) {
            const options = selectElem.querySelectorAll('option');
            options.forEach((opt, index) => {
                semesters.push(opt.innerText.trim());
                semesterValues.push(opt.value);
                if (opt.hasAttribute('selected')) {
                    defaultIndex = index;
                }
            });
        }

        if (semesters.length > 0 && typeof window.AndroidBridgePromise !== 'undefined') {
            let selectedIdx = await window.AndroidBridgePromise.showSingleSelection(
                "请选择要导入的学期", 
                JSON.stringify(semesters), 
                defaultIndex
            );

            if (selectedIdx === null) {
                AndroidBridge.showToast("已取消导入");
                return;
            }

            if (selectedIdx !== defaultIndex) {
                AndroidBridge.showToast(`正在获取 [${semesters[selectedIdx]}] 课表...`);
                let formData = new URLSearchParams();
                formData.append('xnxq01id', semesterValues[selectedIdx]);

                const postResponse = await fetch('/jsxsd/xskb/xskb_list.do', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData.toString()
                });
                const postHtml = await postResponse.text();
                doc = parser.parseFromString(postHtml, 'text/html');
            }
        }

        const courses = extractCoursesFromDoc(doc);
        
        if (courses.length === 0) {
            const errMsg = "未能解析到任何课程，请检查是否暂无排课。";
            if (typeof window.AndroidBridgePromise !== 'undefined') {
                await window.AndroidBridgePromise.showAlert("提示", errMsg, "好的");
            } else {
                alert(errMsg);
            }
            return;
        }

        const config = getCourseConfig();
        const timeSlots = getPresetTimeSlots();

        // 浏览器测试环境，直接输出结果
        if (typeof window.AndroidBridgePromise === 'undefined') {
            console.log("【测试成功】课表配置：", config);
            console.log("【测试成功】作息时间：", timeSlots);
            console.log("【测试成功】课程数据：", courses);
            alert(`解析成功！获取到 ${courses.length} 门课程以及作息时间。请打开F12控制台查看。`);
            return;
        }

        // APP 环境，执行保存配置和作息时间
        const configSaved = await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        const timeSlotsSaved = await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        if (!configSaved || !timeSlotsSaved) {
            AndroidBridge.showToast("保存课表时间配置失败！");
            // 注意：时间配置失败不一定阻断课程导入，这里选择继续导入课程
        }

        // APP 环境，执行保存课程
        const saveResult = await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(courses));
        if (!saveResult) {
            AndroidBridge.showToast("保存课程失败，请重试！");
            return;
        }

        AndroidBridge.showToast(`成功导入 ${courses.length} 节课程及作息时间！`);
        AndroidBridge.notifyTaskCompletion();

    } catch (error) {
        if (typeof window.AndroidBridge !== 'undefined') {
            AndroidBridge.showToast("导入发生异常: " + error.message);
        } else {
            console.error("【导入发生异常】", error);
            alert("导入发生异常: " + error.message);
        }
    }
}

runImportFlow();