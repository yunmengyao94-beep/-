# -*- coding: utf-8 -*-
"""四份交付文档的公共排版工具：封面、标题、表格、图片、页眉页脚、目录域。"""

import os

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(BASE, "交付文档")
IMG_DIR = os.path.join(OUT_DIR, "images")

PRIMARY = RGBColor(0x1F, 0x6F, 0xEB)
DARK = RGBColor(0x12, 0x23, 0x3F)
GRAY = RGBColor(0x66, 0x6E, 0x7A)

FONT_CN = "宋体"
FONT_CN_HEAD = "微软雅黑"
FONT_EN = "Times New Roman"


def _set_run_font(run, cn=FONT_CN, en=FONT_EN, size=10.5, bold=False, color=None):
    run.font.name = en
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), cn)
    rfonts.set(qn("w:ascii"), en)
    rfonts.set(qn("w:hAnsi"), en)


def _field(paragraph, instr, placeholder=""):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = instr
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    text_el = OxmlElement("w:t")
    text_el.text = placeholder
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")

    run._r.append(begin)
    run._r.append(instr_el)
    run._r.append(sep)
    run._r.append(text_el)
    run._r.append(end)


def new_document(doc_title):
    doc = Document()

    section = doc.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.4)
    section.bottom_margin = Cm(2.2)
    section.left_margin = Cm(2.6)
    section.right_margin = Cm(2.4)

    normal = doc.styles["Normal"]
    normal.font.name = FONT_EN
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CN)
    normal.paragraph_format.line_spacing = 1.45
    normal.paragraph_format.space_after = Pt(4)

    for level, size in ((1, 16), (2, 13), (3, 11.5)):
        style = doc.styles[f"Heading {level}"]
        style.font.name = FONT_CN_HEAD
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = DARK if level > 1 else RGBColor(0x0B, 0x2F, 0x6B)
        style.element.rPr.rFonts.set(qn("w:eastAsia"), FONT_CN_HEAD)
        style.paragraph_format.space_before = Pt(14 if level == 1 else 10)
        style.paragraph_format.space_after = Pt(6)

    # 页眉 / 页脚
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    _set_run_font(header.add_run(doc_title), cn=FONT_CN_HEAD, size=9, color=GRAY)

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run("第 ")
    _set_run_font(run, size=9, color=GRAY)
    _field(footer, "PAGE", "1")
    run = footer.add_run(" 页 / 共 ")
    _set_run_font(run, size=9, color=GRAY)
    _field(footer, "NUMPAGES", "1")
    run = footer.add_run(" 页")
    _set_run_font(run, size=9, color=GRAY)

    return doc


def cover(doc, title, subtitle, meta):
    for _ in range(4):
        doc.add_paragraph()

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_run_font(p.add_run("庆师易校圈"), cn=FONT_CN_HEAD, size=20, bold=True, color=GRAY)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(18)
    _set_run_font(p.add_run(title), cn=FONT_CN_HEAD, size=30, bold=True, color=DARK)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(8)
    _set_run_font(p.add_run(subtitle), cn=FONT_CN_HEAD, size=13, color=PRIMARY)

    for _ in range(4):
        doc.add_paragraph()

    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    for key, value in meta:
        row = table.add_row().cells
        row[0].width = Cm(4.2)
        row[1].width = Cm(8.4)
        _set_run_font(row[0].paragraphs[0].add_run(key), cn=FONT_CN_HEAD, size=10.5, bold=True)
        _set_run_font(row[1].paragraphs[0].add_run(value), size=10.5)
        row[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    for _ in range(3):
        doc.add_paragraph()

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_run_font(p.add_run("2026 年 11 月"), size=11, color=GRAY)

    doc.add_page_break()


def toc(doc):
    doc.add_heading("目  录", level=1)
    p = doc.add_paragraph()
    _set_run_font(p.add_run("（章节顺序如下，页码见页面底部）"), size=9, color=GRAY)
    marker = doc.add_paragraph()
    _set_run_font(marker.add_run("__TOC_MARKER__"), size=9, color=GRAY)
    doc.add_page_break()


def _fill_toc(doc):
    """用文档中已有的标题生成静态目录（不依赖 Word 更新域）。"""
    marker = None
    for paragraph in doc.paragraphs:
        if paragraph.text.strip() == "__TOC_MARKER__":
            marker = paragraph
            break
    if marker is None:
        return

    entries = [
        (paragraph.style.name, paragraph.text.strip())
        for paragraph in doc.paragraphs
        if paragraph.style.name in ("Heading 1", "Heading 2")
        and paragraph.text.strip()
        and paragraph.text.strip() != "目  录"
    ]

    anchor = marker._p
    for style_name, title in entries:
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(1)
        paragraph.paragraph_format.line_spacing = 1.0
        paragraph.paragraph_format.space_before = Pt(4 if style_name == "Heading 1" else 0)
        if style_name == "Heading 2":
            paragraph.paragraph_format.left_indent = Cm(0.9)
        _set_run_font(
            paragraph.add_run(title),
            cn=FONT_CN_HEAD if style_name == "Heading 1" else FONT_CN,
            size=10 if style_name == "Heading 1" else 9.5,
            bold=(style_name == "Heading 1"),
            color=DARK if style_name == "Heading 1" else GRAY,
        )
        anchor.addnext(paragraph._p)
        anchor = paragraph._p

    marker._p.getparent().remove(marker._p)


def h1(doc, text):
    heading = doc.add_heading(text, level=1)
    heading.paragraph_format.keep_with_next = True


def h2(doc, text):
    heading = doc.add_heading(text, level=2)
    heading.paragraph_format.keep_with_next = True


def h3(doc, text):
    doc.add_heading(text, level=3)


def p(doc, text, bold=False, indent=True, size=10.5, color=None, align=None, space_after=4):
    paragraph = doc.add_paragraph()
    if indent:
        paragraph.paragraph_format.first_line_indent = Pt(21)
    paragraph.paragraph_format.space_after = Pt(space_after)
    if align is not None:
        paragraph.alignment = align
    _set_run_font(paragraph.add_run(text), size=size, bold=bold, color=color)
    return paragraph


def bullets(doc, items, numbered=False):
    for i, item in enumerate(items, 1):
        paragraph = doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Cm(0.75)
        paragraph.paragraph_format.space_after = Pt(2)
        prefix = f"{i}. " if numbered else "• "
        _set_run_font(paragraph.add_run(prefix + item), size=10.5)


def table(doc, headers, rows, widths=None, caption=None, font_size=9, header_fill="1F6FEB"):
    if caption:
        cp = doc.add_paragraph()
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_run_font(cp.add_run(caption), cn=FONT_CN_HEAD, size=9.5, bold=True, color=DARK)
        cp.paragraph_format.space_before = Pt(6)
        cp.paragraph_format.space_after = Pt(3)
        cp.paragraph_format.keep_with_next = True

    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False

    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    t._tbl.tblPr.append(layout)

    hdr = t.rows[0].cells
    for i, name in enumerate(headers):
        hdr[i].text = ""
        paragraph = hdr[i].paragraphs[0]
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_run_font(paragraph.add_run(name), cn=FONT_CN_HEAD, size=font_size, bold=True,
                      color=RGBColor(0xFF, 0xFF, 0xFF))
        shade = OxmlElement("w:shd")
        shade.set(qn("w:fill"), header_fill)
        hdr[i]._tc.get_or_add_tcPr().append(shade)

    for row_data in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row_data):
            cells[i].text = ""
            paragraph = cells[i].paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            _set_run_font(paragraph.add_run(str(value)), size=font_size)

    if widths:
        for i, width in enumerate(widths):
            t.columns[i].width = Cm(width)
        for row in t.rows:
            for i, width in enumerate(widths):
                row.cells[i].width = Cm(width)

    # 行不跨页；表头跨页重复
    for row in t.rows:
        tr_pr = row._tr.get_or_add_trPr()
        tr_pr.append(OxmlElement("w:cantSplit"))
    t.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))

    doc.add_paragraph()
    return t


def figure(doc, filename, caption, width_cm=15.5):
    path = os.path.join(IMG_DIR, filename)
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.add_run().add_picture(path, width=Cm(width_cm))
    cp = doc.add_paragraph()
    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_run_font(cp.add_run(caption), cn=FONT_CN_HEAD, size=9.5, bold=True, color=DARK)


def note(doc, text):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Cm(0.4)
    paragraph.paragraph_format.space_before = Pt(4)
    _set_run_font(paragraph.add_run(text), size=9.5, color=GRAY)


def save(doc, filename):
    _fill_toc(doc)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, filename)
    doc.save(path)
    print("saved:", path)
    return path
