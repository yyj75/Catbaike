// ==UserScript==
// @name         百度百科词条采集导出
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在百度百科词条页右上角添加采集面板，一键采集 标题/简介/基本信息栏/目录/正文/浏览次数/编辑次数/点赞次数/转发次数 并导出为 CSV
// @author       You
// @match        *://baike.baidu.com/item/*
// @match        *://baike.baidu.com/view/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* ================= 字段定义 ================= */
    const FIELDS = [
        { key: 'title',      label: '标题' },
        { key: 'summary',    label: '简介' },
        { key: 'basicInfo',  label: '基本信息栏' },
        { key: 'toc',        label: '目录' },
        { key: 'content',    label: '正文' },
        { key: 'views',      label: '浏览次数' },
        { key: 'edits',      label: '编辑次数' },
        { key: 'likes',      label: '点赞次数' },
        { key: 'shares',     label: '转发次数' },
    ];

    /* ================= 通用工具 ================= */

    function getPageText() {
        if (!document.body) return '';
        return (document.body.innerText || '').replace(/\s+/g, ' ');
    }

    function parseCount(raw) {
        if (raw === null || raw === undefined) return '';
        const s = String(raw).replace(/[,\s]/g, '');
        if (!s) return '';
        let mul = 1;
        if (s.indexOf('亿') > -1) mul = 100000000;
        else if (s.indexOf('万') > -1) mul = 10000;
        const num = parseFloat(s.replace(/[^\d.]/g, ''));
        if (isNaN(num)) return '';
        return String(Math.round(num * mul));
    }

    function matchLabel(text, label) {
        if (!text) return '';
        const NUM = '([\\d,]+(?:\\.\\d+)?)';
        const UNIT = '([万亿])?';
        let m = text.match(new RegExp(label + '\\s*[：:]?\\s*' + NUM + '\\s*' + UNIT));
        if (m) {
            const n = parseCount(m[1] + (m[2] || ''));
            if (n !== '') return n;
        }
        m = text.match(new RegExp(NUM + '\\s*' + UNIT + '\\s*[次个]?\\s*' + label));
        if (m) {
            const n = parseCount(m[1] + (m[2] || ''));
            if (n !== '') return n;
        }
        return '';
    }

    function collectStat(labels) {
        const containers = document.querySelectorAll(
            '.lemma-statistics, [class*="lemmaStatistics"], [class*="statistics"], [class*="statistic"]'
        );
        for (let i = 0; i < containers.length; i++) {
            const txt = (containers[i].innerText || '').replace(/\s+/g, ' ');
            for (let j = 0; j < labels.length; j++) {
                const v = matchLabel(txt, labels[j]);
                if (v) return v;
            }
        }
        const pageTxt = getPageText();
        for (let j = 0; j < labels.length; j++) {
            const v = matchLabel(pageTxt, labels[j]);
            if (v) return v;
        }
        return '';
    }

    function pickNumberFrom(root) {
        if (!root) return '';
        const texts = [];
        const walk = [root];
        while (walk.length) {
            const el = walk.shift();
            if (!el || el.nodeType !== 1) continue;
            const t = (el.textContent || '').trim();
            if (t) texts.push(t);
            const kids = el.children;
            for (let i = 0; i < kids.length; i++) walk.push(kids[i]);
        }
        for (let i = 0; i < texts.length; i++) {
            if (/^[\d,\.]+\s*[万亿]?$/.test(texts[i])) {
                const n = parseCount(texts[i]);
                if (n !== '') return n;
            }
        }
        for (let i = 0; i < texts.length; i++) {
            const m = texts[i].match(/([\d,]+(?:\.\d+)?\s*[万亿]?)/);
            if (m) {
                const n = parseCount(m[1]);
                if (n !== '') return n;
            }
        }
        return '';
    }

    function cleanText(s) {
        if (!s) return '';
        return String(s)
            .replace(/\[\d+(?:-\d+)?\]/g, '')   // 引用角标
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /* ================= 内容类字段 ================= */

    /** 标题：优先 h1，其次 .lemma-title，最后从 document.title 提取 */
    function collectTitle() {
        const sels = [
            'h1',
            '.lemma-title',
            '[class*="lemmaTitle"]',
            '[class*="lemma-title"]',
            '[class*="J-lemma-title"]',
        ];
        for (let i = 0; i < sels.length; i++) {
            const el = document.querySelector(sels[i]);
            if (!el) continue;
            const t = cleanText(el.innerText || el.textContent || '');
            if (t) return t;
        }
        return cleanText((document.title || '').replace(/[-_—]百度百科.*$/, ''));
    }

    /** 简介：词条首屏概述段 */
    function collectSummary() {
        const sels = [
            'div.lemma-summary',
            '.lemma-summary',
            '[class*="lemmaSummary"]',
            '.J-summary',
            '#lemma-summary',
            '.para-summary',
            '[class*="summary"]',
        ];
        for (let i = 0; i < sels.length; i++) {
            const el = document.querySelector(sels[i]);
            if (!el) continue;
            const t = cleanText(el.innerText || el.textContent || '');
            if (t) return t;
        }
        return '';
    }

    /**
     * 基本信息栏：词条右上角的信息表（如 中文名 / 外文名 / 别名 / 出生地 等）
     * 输出格式：每行 "字段名: 值"
     */
    function collectBasicInfo() {
        const containers = [
            '.lemmaWgt-lemmaBasicInfo',
            '[class*="lemmaBasicInfo"]',
            '[class*="basic-info"]',
            '[class*="basicInfo"]',
            '.basic-info',
        ];

        for (let i = 0; i < containers.length; i++) {
            const box = document.querySelector(containers[i]);
            if (!box) continue;
            const lines = [];

            // 常见格式一：<dl><dt>键</dt><dd>值</dd>...</dl>
            const dts = box.querySelectorAll('dt');
            const dds = box.querySelectorAll('dd');
            if (dts.length && dds.length) {
                for (let j = 0; j < Math.min(dts.length, dds.length); j++) {
                    const k = cleanText(dts[j].innerText || dts[j].textContent || '');
                    const v = cleanText(dds[j].innerText || dds[j].textContent || '');
                    if (k || v) lines.push(k + ': ' + v);
                }
                if (lines.length) return lines.join('\n');
            }

            // 常见格式二：<div class="item"><span class="name">键</span><span class="value">值</span></div>
            const items = box.querySelectorAll('[class*="item"], li, tr');
            for (let j = 0; j < items.length; j++) {
                const it = items[j];
                const nameEl = it.querySelector('[class*="name"], [class*="key"], [class*="label"], th');
                const valEl  = it.querySelector('[class*="value"], [class*="val"], td');
                if (nameEl && valEl && nameEl !== valEl) {
                    const k = cleanText(nameEl.innerText || nameEl.textContent || '');
                    const v = cleanText(valEl.innerText  || valEl.textContent  || '');
                    if (k || v) lines.push(k + ': ' + v);
                }
            }
            if (lines.length) {
                // 去掉可能重复的行
                const seen = Object.create(null);
                const uniq = [];
                for (let j = 0; j < lines.length; j++) {
                    if (seen[lines[j]]) continue;
                    seen[lines[j]] = 1;
                    uniq.push(lines[j]);
                }
                return uniq.join('\n');
            }

            // 兜底：直接把文本按行拆
            const txt = cleanText(box.innerText || box.textContent || '');
            if (txt) return txt;
        }
        return '';
    }

    /** 目录：优先右侧目录导航，兜底用正文标题结构 */
    function collectTOC() {
        const sels = [
            '.catalog-list',
            '.lemma-catalog',
            '.side-catalog',
            '.catalog-list-wrapper',
            '[class*="catalog-list"]',
            '[class*="catalogList"]',
            '.toc',
        ];
        for (let i = 0; i < sels.length; i++) {
            const box = document.querySelector(sels[i]);
            if (!box) continue;
            const items = [];
            const seen = Object.create(null);
            const links = box.querySelectorAll('a');
            for (let j = 0; j < links.length; j++) {
                const a = links[j];
                const t = cleanText(a.innerText || a.textContent || '');
                if (!t || seen[t]) continue;
                seen[t] = 1;
                const parentCls = a.parentElement ? (a.parentElement.className || '') : '';
                const cls = (a.className || '') + ' ' + parentCls;
                const isSub = /level-?2|sub-?item|second/i.test(cls);
                items.push(isSub ? '  ' + t : t);
            }
            if (items.length) return items.join('\n');
        }
        const heads = document.querySelectorAll('.para-title, [class*="paraTitle"]');
        const out = [];
        const seen2 = Object.create(null);
        for (let i = 0; i < heads.length; i++) {
            const t = cleanText(heads[i].innerText || heads[i].textContent || '');
            if (t && !seen2[t]) { seen2[t] = 1; out.push(t); }
        }
        return out.join('\n');
    }

    /**
     * 正文（非结构化文本）：
     *   从 mainContent 容器提取纯文本，剔除目录导航、图注按钮等噪音
     */
    function collectContent() {
        let root = null;
        const cands = [
            '[class*="mainContent"]',
            '#J-lemma-main-wrapper [class*="mainContent"]',
            '.lemma-main-content',
            '.main-content',
            '#J-lemma-main-wrapper',
        ];
        for (let i = 0; i < cands.length; i++) {
            const el = document.querySelector(cands[i]);
            if (el) { root = el; break; }
        }
        if (!root) return '';

        // 克隆一份，避免影响原页面
        const clone = root.cloneNode(true);

        // 剔除明显噪音节点
        const noiseSels = [
            'script', 'style', 'noscript',
            '.catalog-list', '[class*="catalog-list"]', '[class*="catalogList"]',
            '.side-catalog', '.lemma-catalog',
            '[class*="reference"]', '[class*="Reference"]',
            '[class*="editBtn"]', '[class*="edit-button"]',
            '[class*="shareBtn"]', '[class*="collect"]',
            '[class*="topTools"]', '[class*="topVote"]', '[class*="topShare"]',
            '[class*="toolbar"]', '[class*="Toolbar"]',
            '.album-list', '[class*="albumList"]',
            '[class*="videoWrap"]', '[class*="video-wrap"]',
            'button',
        ];
        noiseSels.forEach(function (sel) {
            try {
                clone.querySelectorAll(sel).forEach(function (n) {
                    if (n.parentNode) n.parentNode.removeChild(n);
                });
            } catch (e) { /* 忽略非法选择器 */ }
        });

        // 优先使用 innerText 保留换行（需插入文档或读取原节点）
        // 由于克隆节点脱离文档流后 innerText 可能返回 ''，这里直接读原容器的 innerText
        // 但不剔除噪音；因此折中方案：用原节点 innerText 作为基础文本，噪音在后续正则里清
        let text = '';

        // 方法 1：直接读原容器的 innerText（保换行）
        text = root.innerText || root.textContent || '';

        // 方法 2：若为空，退回克隆节点 textContent
        if (!text.trim()) {
            text = clone.textContent || '';
        }

        // 清理：去掉 [1] 引用角标、多余空白、常见 UI 文案
        text = text
            .replace(/\[\d+(?:-\d+)?\]/g, '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n');

        // 逐行清理
        const lines = text.split('\n').map(function (l) { return l.trim(); });
        const out = [];
        const noiseLinePatterns = [
            /^展开全部$/,
            /^收起$/,
            /^展开$/,
            /^编辑$/,
            /^分享$/,
            /^收藏$/,
            /^有用\s*\(?\d*\)?$/,
            /^分享\s*\(?\d*\)?$/,
            /^目录$/,
            /^参考文献$/,
            /^词条标签[:：]?.*$/,
            /^\d+$/,
            /^[·•]\s*$/,
        ];
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (!l) { out.push(''); continue; }
            let skip = false;
            for (let j = 0; j < noiseLinePatterns.length; j++) {
                if (noiseLinePatterns[j].test(l)) { skip = true; break; }
            }
            if (!skip) out.push(l);
        }

        return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    /* ================= 统计类字段 ================= */

    function collectViews() {
        return collectStat(['浏览次数', '浏览']);
    }

    function collectEdits() {
        return collectStat(['编辑次数', '编辑']);
    }

    /** 点赞次数：新版显示为"有用" */
    function collectLikes() {
        const sels = [
            '[class*="topVote"] [class*="voteCount"] span',
            '[class*="voteCount"] span',
            '[class*="voteCount"]',
        ];
        for (let i = 0; i < sels.length; i++) {
            const el = document.querySelector(sels[i]);
            if (!el) continue;
            const n = parseCount((el.innerText || el.textContent || '').trim());
            if (n !== '') return n;
        }
        const boxes = document.querySelectorAll('[class*="topVote"]');
        for (let i = 0; i < boxes.length; i++) {
            const n = pickNumberFrom(boxes[i]);
            if (n !== '') return n;
        }
        const pageTxt = getPageText();
        let m = pageTxt.match(/([\d,]+(?:\.\d+)?\s*[万亿]?)\s*有用/);
        if (m) { const n = parseCount(m[1]); if (n !== '') return n; }
        m = pageTxt.match(/有用\s*[：:]?\s*([\d,]+(?:\.\d+)?\s*[万亿]?)/);
        if (m) { const n = parseCount(m[1]); if (n !== '') return n; }
        return collectStat(['点赞次数', '点赞量', '点赞', '获赞']);
    }

    /** 转发次数：新版显示为"分享" */
    function collectShares() {
        const boxes = document.querySelectorAll('[class*="topShare"]');
        for (let i = 0; i < boxes.length; i++) {
            const n = pickNumberFrom(boxes[i]);
            if (n !== '') return n;
        }
        const sels = [
            '[class*="shareCount"] span',
            '[class*="shareCount"]',
            '[class*="topShare"] span',
        ];
        for (let i = 0; i < sels.length; i++) {
            const el = document.querySelector(sels[i]);
            if (!el) continue;
            const n = parseCount((el.innerText || el.textContent || '').trim());
            if (n !== '') return n;
        }
        const pageTxt = getPageText();
        let m = pageTxt.match(/([\d,]+(?:\.\d+)?\s*[万亿]?)\s*分享/);
        if (m) { const n = parseCount(m[1]); if (n !== '') return n; }
        m = pageTxt.match(/分享\s*[：:]?\s*([\d,]+(?:\.\d+)?\s*[万亿]?)/);
        if (m) { const n = parseCount(m[1]); if (n !== '') return n; }
        return collectStat(['转发次数', '转发量', '转发']);
    }

    /* ================= 汇总 ================= */

    function collectAll() {
        return {
            title:     collectTitle(),
            summary:   collectSummary(),
            basicInfo: collectBasicInfo(),
            toc:       collectTOC(),
            content:   collectContent(),
            views:     collectViews(),
            edits:     collectEdits(),
            likes:     collectLikes(),
            shares:    collectShares(),
        };
    }

    /* ================= CSV 生成与下载 ================= */

    function csvCell(v) {
        const s = (v === null || v === undefined) ? '' : String(v);
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function buildCSV(data) {
        const header = FIELDS.map(function (f) { return csvCell(f.label); }).join(',');
        const row = FIELDS.map(function (f) { return csvCell(data[f.key]); }).join(',');
        return header + '\r\n' + row + '\r\n';
    }

    function safeFileName(s) {
        return String(s || '').replace(/[\\\/:*?"<>|\r\n\t]/g, '_').slice(0, 60) || '词条';
    }

    function todayStr() {
        const d = new Date();
        const pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    }

    function downloadCSV(csv, filename) {
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    /* ================= UI ================= */

    let statusEl = null;

    function setStatus(msg, color) {
        if (!statusEl) return;
        statusEl.innerHTML = String(msg).replace(/\n/g, '<br>');
        statusEl.style.color = color || '#666';
    }

    function createUI() {
        const style = document.createElement('style');
        style.textContent = `
            #bke-panel {
                position: fixed; top: 100px; right: 20px; z-index: 999999;
                width: 230px; background: #fff; padding: 14px;
                border-radius: 8px; border-left: 5px solid #4e6ef2;
                box-shadow: 0 4px 16px rgba(0,0,0,0.18);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
                font-size: 13px; color: #333; line-height: 1.5;
            }
            #bke-panel .bke-title { font-weight: bold; margin-bottom: 8px; font-size: 14px; }
            #bke-panel .bke-status { font-size: 12px; color: #666; margin-bottom: 10px; min-height: 32px; word-break: break-all; }
            #bke-panel .bke-btn {
                width: 100%; padding: 8px; background: #4e6ef2; color: #fff;
                border: none; border-radius: 4px; cursor: pointer;
                font-weight: bold; font-size: 13px; transition: background .2s;
            }
            #bke-panel .bke-btn:hover { background: #3b5bdb; }
            #bke-panel .bke-btn:active { transform: translateY(1px); }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'bke-panel';
        panel.innerHTML =
            '<div class="bke-title">📋 百度百科词条采集</div>' +
            '<div class="bke-status" id="bke-status">⏳ 正在读取页面数据…</div>' +
            '<button class="bke-btn" id="bke-export">📥 采集并导出 CSV</button>';
        document.body.appendChild(panel);
        statusEl = panel.querySelector('#bke-status');
        panel.querySelector('#bke-export').addEventListener('click', function () { doExport(); });
    }

    /* ================= 导出 ================= */

    function doExport() {
        let data;
        try {
            data = collectAll();
        } catch (e) {
            console.error(e);
            setStatus('❌ 采集出错：' + e.message, '#f56c6c');
            return;
        }

        const filled = FIELDS.filter(function (f) {
            return String(data[f.key] || '').trim() !== '';
        });
        const missing = FIELDS.filter(function (f) {
            return String(data[f.key] || '').trim() === '';
        });

        if (filled.length === 0) {
            setStatus('⚠️ 未读取到数据\n请等页面加载完成后重试', '#e6a23c');
            return;
        }

        const csv = buildCSV(data);
        const filename = '百度百科_' + safeFileName(data.title || '词条') + '_' + todayStr() + '.csv';
        downloadCSV(csv, filename);

        let msg = '✅ 已导出 ' + filled.length + '/' + FIELDS.length + ' 项';
        if (missing.length) msg += '\n未获取：' + missing.map(function (f) { return f.label; }).join('、');
        setStatus(msg, missing.length ? '#e6a23c' : '#52c41a');
    }

    function autoScan() {
        try {
            const data = collectAll();
            const filled = FIELDS.filter(function (f) {
                return String(data[f.key] || '').trim() !== '';
            }).length;
            setStatus('📊 已识别 ' + filled + '/' + FIELDS.length + ' 项数据\n点击下方按钮导出', '#52c41a');
        } catch (e) {
            setStatus('⏳ 等待页面渲染…');
        }
    }

    /* ================= 启动 ================= */

    function init() {
        if (!document.body) { setTimeout(init, 200); return; }
        createUI();
        setTimeout(autoScan, 1500);
    }

    init();

})();