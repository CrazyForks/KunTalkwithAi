package com.example.everytalk.ui.components

// 统一的基础 Markdown 规范化（字形 -> 标题/列表/表格容错）
fun normalizeBasicMarkdown(text: String): String {
    if (text.isEmpty()) return text
    var t = normalizeMarkdownGlyphs(text)
    // 先保护行首粗体，避免与列表/代码块归一化冲突
    t = protectLeadingBoldMarkers(t)
    // 修正轻度缩进的列表（1~3 个空格）为标准左对齐，避免被当作代码块
    t = normalizeSoftIndentedLists(t)
    t = normalizeHeadingSpacing(t)
    t = normalizeListSpacing(t)
    t = normalizeTableSpacing(t) // 🎯 新增：表格格式化
    t = normalizeDetachedBulletPoints(t) // 🔧 新增：处理分离式列表项目符号
    return t
}

/**
 * 标题容错：
 * 1) 行内出现的 ##... -> 强制换行到行首
 * 2) 行首 #{1..6} 后若未跟空格则补空格（###标题 -> ### 标题）
 * 3) 强化：确保标题前后都有空行分隔
 */
private fun normalizeHeadingSpacing(md: String): String {
    if (md.isEmpty()) return md
    var text = md
    
    // 将"行内标题"移到新的一行（避免被当作普通文本）
    val newlineBefore = Regex("(?m)([^\\n])\\s*(#{1,6})(?=\\S)")
    text = text.replace(newlineBefore, "$1\n\n$2")
    
    // 标题后补空格（行首 #... 与后续字符之间补空格）
    val spaceAfter = Regex("(?m)^(#{1,6})([^#\\s])")
    text = text.replace(spaceAfter, "$1 $2")
    
    // 🎯 新增：确保标题前后都有空行（除非在文档开头/结尾）
    val headingWithSpacing = Regex("(?m)^(#{1,6}\\s+.*)$")
    text = text.replace(headingWithSpacing) { match ->
        val heading = match.value
        "\n$heading\n"
    }.replace("^\n+".toRegex(), "").replace("\n+$".toRegex(), "")
    
    return text
}

// 在非代码围栏内规范化列表前缀：
// - 将开头的 *, -, + 后若无空格补空格（排除以 ** 开头的粗体场景）
// - 有序列表的 "1." 或 "1)" 后补空格
// - 将常见的项目符号（• · ・ ﹒ ∙ 以及全角＊﹡）规范为标准 Markdown 列表
private fun normalizeListSpacing(md: String): String {
    if (md.isEmpty()) return md
    val lines = md.split("\n").toMutableList()
    var insideFence = false
    for (i in lines.indices) {
        var line = lines[i]
        if (line.contains("```")) {
            val count = "```".toRegex().findAll(line).count()
            if (count % 2 == 1) insideFence = !insideFence
            lines[i] = line
            continue
        }
        if (!insideFence) {
            // 全角星号转半角并作为列表处理
            line = line.replace(Regex("^(\\s*)[＊﹡]([^\\s])"), "$1* $2")
            // • · ・ ﹒ ∙ 作为项目符号
            line = line.replace(Regex("^(\\s*)[•·・﹒∙]([^\\s])"), "$1- $2")
            // 🔧 修复：处理单独的星号作为列表项目符号
            line = line.replace(Regex("^(\\s*)\\*\\s*$"), "$1- ")
            // 无序列表符号后补空格（避免 ** 触发）
            line = line.replace(Regex("^(\\s*)([*+\\-])(?![ *+\\-])(\\S)"), "$1$2 $3")
            // 规整“多空格”的列表前缀为单空格
            line = line.replace(Regex("^(\\s*)([*+\\-])\\s{2,}"), "$1$2 ")
            // 有序列表（1. 或 1)）后补空格
            line = line.replace(Regex("^(\\s*)(\\d+)([.)])(\\S)"), "$1$2$3 $4")
            // 规整“多空格”的有序列表前缀为单空格
            line = line.replace(Regex("^(\\s*)(\\d+)([.)])\\s{2,}"), "$1$2$3 ")
            lines[i] = line
        }
    }
    return lines.joinToString("\n")
}

/**
 * 🎯 新增：表格格式化 - 确保表格能正确识别和渲染
 */
private fun normalizeTableSpacing(md: String): String {
    if (md.isEmpty()) return md
    val rawLines = md.split("\n")
    val result = mutableListOf<String>()
    var insideFence = false
    var i = 0
    
    // 标准Markdown表格的分隔行：| --- | :---: | ---: |
    val separatorRegex = Regex("^\\|?\\s*:?[-]{3,}:?\\s*(\\|\\s*:?[-]{3,}:?\\s*)+\\|?$")
    
    fun hasAtLeastTwoPipes(s: String): Boolean {
        // 将全角或框线竖线预归一化后再计数
        val t = s.replace("｜", "|").replace("│", "|").replace("┃", "|")
        return t.count { it == '|' } >= 2
    }
    
    fun ensureRowPipes(s: String): String {
        val trimmed = s.trim()
        var fixed = trimmed
        if (!trimmed.startsWith("|")) fixed = "| $fixed"
        if (!trimmed.endsWith("|")) fixed = "$fixed |"
        return fixed
    }
    
    while (i < rawLines.size) {
        var line = rawLines[i]
        
        // 围栏代码块切换
        if (line.contains("```")) {
            val count = "```".toRegex().findAll(line).count()
            if (count % 2 == 1) insideFence = !insideFence
            result.add(line)
            i++
            continue
        }
        if (insideFence) {
            result.add(line)
            i++
            continue
        }
        
        // 仅在“表头行(至少两个竖线)”后紧跟“分隔行”时，认定为表格块
        val headerCandidate = line.replace("｜", "|").replace("│", "|").replace("┃", "|")
        if (hasAtLeastTwoPipes(headerCandidate)) {
            // 找到下一个非空行
            var j = i + 1
            while (j < rawLines.size && rawLines[j].trim().isEmpty()) j++
            if (j < rawLines.size) {
                val sepLine = rawLines[j].trim()
                if (separatorRegex.containsMatchIn(sepLine)) {
                    // 确认进入表格块：规范化表头与分隔行
                    result.add(ensureRowPipes(headerCandidate))
                    result.add(ensureRowPipes(sepLine))
                    i = j + 1
                    // 处理随后的数据行，直到遇到空行或无竖线行
                    while (i < rawLines.size) {
                        val data = rawLines[i]
                        if (data.trim().isEmpty()) {
                            result.add(data)
                            i++
                            break
                        }
                        val normalized = data.replace("｜", "|").replace("│", "|").replace("┃", "|")
                        if (!normalized.contains("|")) {
                            // 非表格行，结束表格块
                            // 不回退 i，这一行将按普通行处理（循环尾不自增，所以不加到 result）
                            break
                        }
                        result.add(ensureRowPipes(normalized))
                        i++
                    }
                    // 继续下一轮（不要在这里 i++）
                    continue
                }
            }
        }
        
        // 非表格场景：保持原样，避免把条件概率 P(B|A) 误判为表格
        result.add(line)
        i++
    }
    
    return result.joinToString("\n")
}

/**
 * 规范化常见 Markdown 符号（最小化处理）：将全角星号替换为半角，
 * 以便 **加粗** / *斜体* 在 Compose MarkdownText 中正确识别。
 * 不处理反引号与代码块围栏。
 */
internal fun normalizeMarkdownGlyphs(text: String): String {
    if (text.isEmpty()) return text
    return text
        // 去除常见不可见字符，避免打断 **bold** / *italic*
        .replace("\u200B", "") // ZERO WIDTH SPACE
        .replace("\u200C", "") // ZERO WIDTH NON-JOINER
        .replace("\u200D", "") // ZERO WIDTH JOINER
        .replace("\uFEFF", "") // ZERO WIDTH NO-BREAK SPACE (BOM)
        // 归一化各类“看起来是空格但不是空格”的字符：防止列表识别失败或被误判为代码块
        .replace('\u00A0', ' ') // NO-BREAK SPACE
        .replace('\u1680', ' ')
        .replace('\u180E', ' ')
        .replace('\u2000', ' ') // EN QUAD
        .replace('\u2001', ' ') // EM QUAD
        .replace('\u2002', ' ') // EN SPACE
        .replace('\u2003', ' ') // EM SPACE
        .replace('\u2004', ' ')
        .replace('\u2005', ' ')
        .replace('\u2006', ' ')
        .replace('\u2007', ' ')
        .replace('\u2008', ' ')
        .replace('\u2009', ' ')
        .replace('\u200A', ' ')
        .replace('\u202F', ' ')
        .replace('\u205F', ' ')
        .replace('\u3000', ' ') // IDEOGRAPHIC SPACE（全角空格）
        .replace("\t", "  ")   // 制表符折算为2空格，避免缩进被当成代码块
        // 统一星号
        .replace('＊', '*')  // 全角星号 -> 半角
        .replace('﹡', '*')  // 小型星号 -> 半角
}

/**
 * 🔧 新增：处理分离式列表项目符号
 * 将单独一行的 * 与下一行的内容合并成标准的Markdown列表项
 */
private fun normalizeDetachedBulletPoints(md: String): String {
    if (md.isEmpty()) return md

    val lines = md.split("\n").toMutableList()
    val result = mutableListOf<String>()
    var i = 0

    while (i < lines.size) {
        val rawLine = lines[i]
        val currentLine = rawLine.trim()

        // 检查是否为单独的项目符号（含软缩进）
        if (currentLine == "*" || currentLine == "-" || currentLine == "+") {
            // 查找下一个非空行作为列表内容
            var nextContentIndex = i + 1
            while (nextContentIndex < lines.size && lines[nextContentIndex].trim().isEmpty()) {
                nextContentIndex++
            }

            if (nextContentIndex < lines.size) {
                val nextContent = lines[nextContentIndex].trim()
                if (nextContent.isNotEmpty()) {
                    // 合并为标准的Markdown列表项，保留下一行内容原貌（含可能的粗体 **）
                    result.add("- $nextContent")
                    // 跳过已处理的行
                    i = nextContentIndex + 1
                    continue
                }
            }
        }

        // 不是项目符号或找不到对应内容，保持原样
        result.add(rawLine)
        i++
    }

    return result.joinToString("\n")
}

/**
 * 🔒 保护行首粗体：确保以 ** 开头的行不会被当作列表项或代码块，同时补空格提高兼容性
 * 例：**标题 -> ** 标题
 */
private fun protectLeadingBoldMarkers(md: String): String {
    // 修复：避免破坏标准粗体 **text** 语法，保持原文返回。
    // 说明：此前在行首 "**" 后强插空格会把 "**文本**" 变为 "** 文本**"，
    // 使 CommonMark 不再识别为粗体。这里改为不做任何修改。
    return md
}

/**
 * 🛠️ 规范轻度缩进的列表：将行首 1~3 个空格 + 列表标记，归一为左对齐，避免被误判为代码块
 * 覆盖无序/有序两种列表前缀
 */
private fun normalizeSoftIndentedLists(md: String): String {
    if (md.isEmpty()) return md
    var text = md
    // 无序列表（*, -, +）
    text = text.replace(Regex("(?m)^ {1,3}([*+\\-])(\\s+)"), "$1 ")
    text = text.replace(Regex("(?m)^ {1,3}([*+\\-])(\\S)"), "$1 $2")
    // 有序列表（1. 或 1)）
    text = text.replace(Regex("(?m)^ {1,3}(\\d+)([.)])(\\s+)"), "$1$2 ")
    text = text.replace(Regex("(?m)^ {1,3}(\\d+)([.)])(\\S)"), "$1$2 $3")
    return text
}