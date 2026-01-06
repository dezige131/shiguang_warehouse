// 山东药品食品职业学院(sddfvc.edu.cn) 拾光课程表适配脚本
// 非该大学开发者适配,开发者无法及时发现问题
// 出现问题请提联系开发者或者提交pr更改,这更加快速

// 数据解析函数

/**
 * 将周次字符串结合单双周标识解析为数字数组
 * @param {string} zcString "7-15,17-20"
 * @param {number} dsz 0: 全周, 1: 单周, 2: 双周, -1: 全周
 */
function parseWeeks(zcString, dsz) {
    let weeks = [];
    if (!zcString) return weeks;

    // 解析基础周次
    zcString.split(',').forEach(part => {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) weeks.push(i);
        } else {
            weeks.push(Number(part));
        }
    });

    // 处理单双周过滤
    if (dsz === 1) {
        weeks = weeks.filter(w => w % 2 !== 0);
    } else if (dsz === 2) {
        weeks = weeks.filter(w => w % 2 === 0);
    }
    return weeks;
}

/**
 * 转换课程格式为应用模型
 */
function parseCoursesToModel(sourceData) {
    const resultCourses = [];
    const days = ["xq1", "xq2", "xq3", "xq4", "xq5", "xq6", "xq7"];
    const sectionMap = { "1": 1, "3": 2, "5": 3, "7": 4 };

    days.forEach((dayKey, index) => {
        const dayContent = sourceData[dayKey];
        if (!dayContent) return;

        Object.keys(dayContent).forEach(slotNum => {
            const mappedSection = sectionMap[slotNum];
            if (!mappedSection) return;

            Object.values(dayContent[slotNum]).forEach(item => {
                const courseName = item.skbj[0][1];

                Object.values(item.pkmx).forEach(detail => {
                    if (!detail) return;

                    const computedWeeks = parseWeeks(detail.zc.zc, detail.zc.dsz);
                    if (computedWeeks.length === 0) return;

                    resultCourses.push({
                        "name": courseName,
                        "teacher": detail.teacher[0]?.xm || "未知教师",
                        "position": detail.classroom || "未知地点",
                        "day": index + 1,
                        "startSection": mappedSection,
                        "endSection": mappedSection,
                        "weeks": computedWeeks
                    });
                });
            });
        });
    });
    return resultCourses;
}

// 网络与交互业务函数

/**
 * 保存课表全局配置
 */
async function saveAppConfig() {
    const config = {
        "defaultClassDuration": 90,
        "defaultBreakDuration": 15,
        "firstDayOfWeek": 1
    };
    return await window.AndroidBridgePromise.saveCourseConfig(JSON.stringify(config));
}

/**
 * 保存时间段配置
 */
async function saveAppTimeSlots() {
    const timeSlots = [
        { "number": 1, "startTime": "08:30", "endTime": "10:00" },
        { "number": 2, "startTime": "10:15", "endTime": "11:45" },
        { "number": 3, "startTime": "13:30", "endTime": "15:00" },
        { "number": 4, "startTime": "15:15", "endTime": "16:45" }
    ];
    return await window.AndroidBridgePromise.savePresetTimeSlots(JSON.stringify(timeSlots));
}

/**
 * 获取并让用户选择学期 ID
 */
async function getSelectedSemesterId(apiToken) {
    const xqRes = await fetch(`http://jwxt.sddfvc.edu.cn/mobile/student/mobile_kcb_xq?api_token=${apiToken}`);
    const xqJson = await xqRes.json();
    const xqList = xqJson.data.xq_all;
    const currentXq = xqJson.data.xq_current;

    const xqNames = xqList.map(item => item.xqmc);
    const defaultIdx = xqList.findIndex(item => item.id === currentXq.id);

    const selectedIdx = await window.AndroidBridgePromise.showSingleSelection(
        "请确认导入学期",
        JSON.stringify(xqNames),
        defaultIdx !== -1 ? defaultIdx : xqNames.length - 1
    );

    return selectedIdx !== null ? xqList[selectedIdx].id : null;
}

// 流程控制

async function runImportFlow() {
    try {
        const tokenMatch = document.cookie.match(/api_token=([^;]+)/);
        if (!tokenMatch) {
            AndroidBridge.showToast("未检测到登录状态，请先登录");
            return;
        }
        const apiToken = tokenMatch[1];

        const semesterId = await getSelectedSemesterId(apiToken);
        if (!semesterId) {
            AndroidBridge.showToast("导入已取消");
            return;
        }

        AndroidBridge.showToast("正在获取课表数据...");
        const kcbRes = await fetch(`http://jwxt.sddfvc.edu.cn/mobile/student/mobile_kcb?api_token=${apiToken}&xq=${semesterId}`);
        const kcbJson = await kcbRes.json();

        const finalCourses = parseCoursesToModel(kcbJson.data);
        if (finalCourses.length === 0) {
            AndroidBridge.showToast("该学期暂无课程");
            return;
        }

        AndroidBridge.showToast("正在保存配置...");
        await saveAppConfig();
        await saveAppTimeSlots();
        await window.AndroidBridgePromise.saveImportedCourses(JSON.stringify(finalCourses));
        
        AndroidBridge.showToast(`成功导入 ${finalCourses.length} 条课程明细`);
        AndroidBridge.notifyTaskCompletion();

    } catch (error) {
        console.error(error);
        AndroidBridge.showToast("异常: " + error.message);
    }
}

runImportFlow();