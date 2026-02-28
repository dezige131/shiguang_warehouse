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
 * 提取课程数据（已适配带有 item-box 二维码和特殊字体的强智新版）
 */
function extractCoursesFromDoc(doc) {
    let parsedCourses = [];
    const table = doc.getElementById('timetable');
    if (!table) throw new Error("请求成功但未找到课表表格，请确认教务系统状态。");

    const rows = table.getElementsByTagName('tr');
    // 跳过表头(0)和尾部的备注行
    for (let i = 1; i < rows.length - 1; i++) {
        const cells = rows[i].getElementsByTagName('td');
        for (let j = 0; j < cells.length; j++) {
            const dayOfWeek = j + 1; // 强智表格：第0个td是周一
            const cell = cells[j];
            
            // 找到包含详细信息的隐藏 div
            const detailDivs = cell.querySelectorAll('div.kbcontent');
            if (detailDivs.length === 0) continue;

            detailDivs.forEach(div => {
                let htmlContent = div.innerHTML;
                if (!htmlContent.trim() || htmlContent === '&nbsp;') return;

                // 强智同一个时间段如果有多门课，用连续破折号分隔
                let courseBlocks = htmlContent.split(/-{10,}\s*<br\s*\/?>/i);

                courseBlocks.forEach(block => {
                    if (!block.trim()) return;

                    let tempDiv = document.createElement('div');
                    tempDiv.innerHTML = block;

                    let courseObj = {
                        day: dayOfWeek,
                        isCustomTime: false
                    };

                    // 1. 提取课程名 (移除二维码 div 后，取第一行纯文本)
                    let itemBoxes = tempDiv.querySelectorAll('.item-box');
                    itemBoxes.forEach(box => box.remove()); // 剔除干扰项
                    
                    let lines = tempDiv.innerHTML.split(/<br\s*\/?>/i);
                    for (let line of lines) {
                        let cleanLine = line.replace(/<[^>]+>/g, '').trim(); // 剥离 font 等 HTML 标签
                        if (cleanLine && cleanLine !== "") {
                            courseObj.name = cleanLine;
                            break;
                        }
                    }

                    // 2. 提取教师
                    let teacherFont = tempDiv.querySelector('font[title="教师"]');
                    courseObj.teacher = teacherFont ? teacherFont.innerText.trim() : "未知";

                    // 3. 提取教室
                    let positionFont = tempDiv.querySelector('font[title="教室"]');
                    courseObj.position = positionFont ? positionFont.innerText.trim() : "待定";

                    // 4. 提取周次和节次 (适配 [01-02节], [03-04-05节], [10节] 等格式)
                    let timeFont = tempDiv.querySelector('font[title="周次(节次)"]');
                    if (timeFont) {
                        let timeText = timeFont.innerText.trim();
                        // 正则：匹配 "X-Y(周)[A-B-C节]" 或 "X(周)[A节]"
                        let timeMatch = timeText.match(/(.+?)\(周\)(?:\[([\d-]+)节\])?/);
                        if (timeMatch) {
                            courseObj.weeks = parseWeeks(timeMatch[1]);
                            if (timeMatch[2]) {
                                let secParts = timeMatch[2].split('-');
                                courseObj.startSection = parseInt(secParts[0]);
                                courseObj.endSection = parseInt(secParts[secParts.length - 1]);
                            } else {
                                // 兜底：如果没有标明节次，则根据行号估算
                                courseObj.startSection = i * 2 - 1;
                                courseObj.endSection = i * 2;
                            }
                        }
                    } else {
                        return; // 如果没有时间信息，抛弃该条记录（比如无课表课程）
                    }

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
 * 生成学校专属的作息时间段
 */
function getPresetTimeSlots() {
    return [
        { "number": 1, "startTime": "08:00", "endTime": "08:40" },
        { "number": 2, "startTime": "08:45", "endTime": "09:25" },
        { "number": 3, "startTime": "09:45", "endTime": "10:25" },
        { "number": 4, "startTime": "10:30", "endTime": "11:10" },
        { "number": 5, "startTime": "11:15", "endTime": "11:55" },
        { "number": 6, "startTime": "14:00", "endTime": "14:40" },
        { "number": 7, "startTime": "14:45", "endTime": "15:25" },
        { "number": 8, "startTime": "15:45", "endTime": "16:25" },
        { "number": 9, "startTime": "16:30", "endTime": "17:10" },
        { "number": 10, "startTime": "18:30", "endTime": "19:10" },
        { "number": 11, "startTime": "19:15", "endTime": "19:55" } 
    ];
}

/**
 * 生成全局课表配置
 */
function getCourseConfig() {
    return {
        "defaultClassDuration": 40, // 单节课 40 分钟
        "defaultBreakDuration": 5   // 默认课间（长课间靠自定义时间段覆盖）
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

        // 浏览器测试环境
        if (typeof window.AndroidBridgePromise === 'undefined') {
            console.log("【测试成功】课表配置：", config);
            console.log("【测试成功】作息时间：", timeSlots);
            console.log("【测试成功】课程数据：\n", JSON.stringify(courses, null, 2));
            alert(`解析成功！获取到 ${courses.length} 门课程以及定制版作息时间。请打开F12控制台查看。`);
            return;
        }

        // APP 环境保存数据
        await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
        await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
        
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