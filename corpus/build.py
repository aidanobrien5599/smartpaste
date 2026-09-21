"""Render the persona corpus to PDFs and write the answer key.

    python3 corpus/build.py

HTML layouts go through Chrome's print-to-PDF, as Google Docs and Canva exports
do; two go through pdflatex; one is rasterised into an image-only PDF, as a
scanned resume is. Output: corpus/pdf/*.pdf and corpus/truth/*.json.
"""

import html
import json
import pathlib
import re
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from personas import PERSONAS  # noqa: E402

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT, TRUTH, WORK = HERE / "pdf", HERE / "truth", HERE / "build"
TEMPLATE_TEX = pathlib.Path.home() / "resume" / "resume.tex"
REAL_RESUME = pathlib.Path.home() / "Desktop" / "AIDAN_OBRIEN_RESUME.pdf"

e = html.escape
DASH = " – "

CSS = """
@page { size: letter; margin: 0.55in; }
body { font: 10.5pt/1.35 'Helvetica Neue', Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 22pt; margin: 0 0 4px; text-align: center; }
h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid #333;
     margin: 12px 0 5px; padding-bottom: 1px; }
.contact { text-align: center; font-size: 9.5pt; }
.row { display: flex; justify-content: space-between; }
ul { margin: 2px 0 6px 18px; padding: 0; } li { margin: 0 0 1px; }
a { color: #111; text-decoration: none; }
.entry { margin-bottom: 5px; }
"""


def link(url, label, as_text):
    shown = re.sub(r"^https?://(www\.)?", "", url) if as_text else label
    return f'<a href="{e(url)}">{e(shown)}</a>'


def contact_bits(p, sep=" | "):
    bits = [e(p["phone"]), f'<a href="mailto:{e(p["email"])}">{e(p["email"])}</a>',
            link(p["linkedin"], "LinkedIn", p["links_as_text"]),
            link(p["github"], "GitHub", p["links_as_text"])]
    return sep.join(bits)


def bullets(items):
    return "<ul>" + "".join(f"<li>{e(b)}</li>" for b in items) + "</ul>"


def edu_line(ed):
    gpa = f" &middot; GPA: {e(ed['gpa'])}" if ed["gpa"] else ""
    return e(ed["degree_text"]) + gpa


# ---------------------------------------------------------------- layouts

def classic(p):
    edu = "".join(
        f'<div class="entry"><div class="row"><b>{e(d["school"])}</b><span>{e(d["place"])}</span></div>'
        f'<div class="row"><i>{edu_line(d)}</i><i>{e(d["start"])}{DASH}{e(d["end"])}</i></div></div>'
        for d in p["education"])
    exp = "".join(
        f'<div class="entry"><div class="row"><b>{e(x["title"])}</b><span>{e(x["start"])}{DASH}{e(x["end"])}</span></div>'
        f'<div class="row"><i>{e(x["company"])}</i><i>{e(x["place"])}</i></div>{bullets(x["bullets"])}</div>'
        for x in p["experience"])
    return (f'<h1>{e(p["name"])}</h1><div class="contact">{contact_bits(p)}</div>'
            f'<h2>Education</h2>{edu}<h2>Experience</h2>{exp}'
            f'<h2>Skills</h2><div>{e(p["skills"])}</div>')


def sidebar(p):
    side = (f'<div style="font-size:9.5pt">{e(p["phone"])}<br>{e(p["email"])}<br>'
            f'{link(p["linkedin"], "LinkedIn", p["links_as_text"])}<br>'
            f'{link(p["github"], "GitHub", p["links_as_text"])}</div>'
            '<h2>Education</h2>' + "".join(
                f'<div class="entry"><b>{e(d["school"])}</b><br>{e(d["degree_text"])}<br>'
                f'{e(d["start"])}{DASH}{e(d["end"])}<br>{e(d["place"])}'
                + (f'<br>GPA {e(d["gpa"])}' if d["gpa"] else "") + '</div>' for d in p["education"])
            + f'<h2>Skills</h2><div>{e(p["skills"])}</div>')
    main = '<h2>Experience</h2>' + "".join(
        f'<div class="entry"><b>{e(x["company"])}</b> &mdash; {e(x["title"])}<br>'
        f'<span style="color:#555">{e(x["start"])}{DASH}{e(x["end"])} &middot; {e(x["place"])}</span>'
        f'{bullets(x["bullets"])}</div>' for x in p["experience"])
    return (f'<h1 style="text-align:left">{e(p["name"])}</h1>'
            f'<div style="display:flex;gap:22px"><div style="width:32%">{side}</div>'
            f'<div style="flex:1">{main}</div></div>')


def dates_left(p):
    def item(dates, head, sub, body=""):
        return (f'<div style="display:grid;grid-template-columns:1.25in 1fr;margin-bottom:6px">'
                f'<div style="color:#444">{dates}</div><div>{head}<br><i>{sub}</i>{body}</div></div>')
    edu = "".join(item(f'{e(d["start"])}{DASH}{e(d["end"])}',
                       f'<b>{e(d["school"])}</b>, {e(d["place"])}', edu_line(d)) for d in p["education"])
    exp = "".join(item(f'{e(x["start"])}{DASH}{e(x["end"])}',
                       f'<b>{e(x["company"])}</b>, {e(x["place"])}', e(x["title"]), bullets(x["bullets"]))
                  for x in p["experience"])
    return (f'<h1>{e(p["name"])}</h1><div class="contact">{contact_bits(p)}</div>'
            f'<h2>Education</h2>{edu}<h2>Work Experience</h2>{exp}'
            f'<h2>Skills</h2>{e(p["skills"])}')


def table(p):
    def rows(entries, kind):
        out = ""
        for x in entries:
            left = (f'<b>{e(x["school"])}</b><br>{edu_line(x)}' if kind == "edu"
                    else f'<b>{e(x["company"])}</b><br><i>{e(x["title"])}</i>{bullets(x["bullets"])}')
            out += (f'<tr><td style="vertical-align:top;padding:3px 0">{left}</td>'
                    f'<td style="vertical-align:top;text-align:right;white-space:nowrap">'
                    f'{e(x["place"])}<br>{e(x["start"])}{DASH}{e(x["end"])}</td></tr>')
        return out
    return (f'<h1>{e(p["name"])}</h1><div class="contact">{contact_bits(p)}</div>'
            f'<table style="width:100%;border-collapse:collapse">'
            f'<tr><td colspan=2><h2>EDUCATION</h2></td></tr>{rows(p["education"], "edu")}'
            f'<tr><td colspan=2><h2>EXPERIENCE</h2></td></tr>{rows(p["experience"], "exp")}'
            f'<tr><td colspan=2><h2>SKILLS</h2>{e(p["skills"])}</td></tr></table>')


def renamed(p):
    contact = (f'✉ {e(p["email"])} &nbsp; ☎ {e(p["phone"])} &nbsp; '
               f'\U0001f517 {link(p["linkedin"], "LinkedIn", p["links_as_text"])} &nbsp; '
               f'\U0001f4bb {link(p["github"], "GitHub", p["links_as_text"])}')
    edu = "".join(
        f'<div class="entry"><b>{e(d["school"])}</b> &mdash; {edu_line(d)}<br>'
        f'{e(d["place"])} | {e(d["start"])}{DASH}{e(d["end"])}</div>' for d in p["education"])
    exp = "".join(
        f'<div class="entry"><b>{e(x["company"])}</b> &mdash; {e(x["title"])}<br>'
        f'{e(x["place"])} | {e(x["start"])}{DASH}{e(x["end"])}{bullets(x["bullets"])}</div>'
        for x in p["experience"])
    return (f'<h1>{e(p["name"])}</h1><div class="contact">{contact}</div>'
            f'<h2>Professional Experience</h2>{exp}<h2>Academic Background</h2>{edu}'
            f'<h2>Technical Skills</h2>{e(p["skills"])}')


def experience_first(p):
    exp = "".join(
        f'<div class="entry"><div class="row"><b>{e(x["company"])}</b><span>{e(x["place"])}</span></div>'
        f'<div class="row"><i>{e(x["title"])}</i><span>{e(x["start"])}{DASH}{e(x["end"])}</span></div>'
        f'{bullets(x["bullets"])}</div>' for x in p["experience"])
    edu = "".join(
        f'<div class="entry"><div class="row"><b>{e(d["school"])}</b><span>{e(d["place"])}</span></div>'
        f'<div class="row"><i>{edu_line(d)}</i><span>Expected {e(d["end"])}</span></div></div>'
        for d in p["education"])
    return (f'<h1 style="text-align:left;margin-bottom:0">{e(p["name"])}</h1>'
            f'<div style="color:#555;margin-bottom:6px">Data scientist and backend engineer</div>'
            f'<div>{contact_bits(p, " &middot; ")}</div>'
            f'<h2>Experience</h2>{exp}<h2>Education</h2>{edu}<h2>Skills</h2>{e(p["skills"])}')


def stacked(p):
    exp = "".join(
        f'<div class="entry"><b>{e(x["company"])}</b><br>{e(x["title"])}<br>'
        f'<span style="color:#555">{e(x["start"])}{DASH}{e(x["end"])}, {e(x["place"])}</span>'
        f'{bullets(x["bullets"])}</div>' for x in p["experience"])
    edu = "".join(
        f'<div class="entry"><b>{e(d["school"])}</b><br>{edu_line(d)}<br>'
        f'<span style="color:#555">{e(d["start"])}{DASH}{e(d["end"])}, {e(d["place"])}</span></div>'
        for d in p["education"])
    return (f'<h1 style="text-align:left">{e(p["name"])}</h1><div>{contact_bits(p)}</div>'
            f'<h2>Education</h2>{edu}<h2>Experience</h2>{exp}<h2>Skills</h2>{e(p["skills"])}')


HTML_LAYOUTS = {"classic": classic, "sidebar": sidebar, "dates-left": dates_left, "table": table,
                "renamed": renamed, "experience-first": experience_first, "stacked": stacked}

# ------------------------------------------------------------------- latex

def tex(s):
    return (s.replace("\\", r"\textbackslash{}").replace("&", r"\&").replace("%", r"\%")
            .replace("$", r"\$").replace("#", r"\#").replace("_", r"\_"))


def latex_template(p):
    source = TEMPLATE_TEX.read_text()
    preamble = source[: source.index(r"\begin{document}")]
    link_text = lambda url, label: tex(re.sub(r"^https?://(www\.)?", "", url)) if p["links_as_text"] else label
    head = (r"\begin{center}\textbf{\Huge \scshape " + tex(p["name"]) + r"} \vspace{0.15cm}\\ \small "
            r"\faPhone\hspace{0.01cm} " + tex(p["phone"]) + r" $|$ \faEnvelope\hspace{0.01cm} "
            r"\href{mailto:" + p["email"] + "}{\\underline{" + tex(p["email"]) + r"}} $|$ "
            r"\faLinkedin\hspace{0.01cm} \href{" + p["linkedin"] + "}{\\underline{" + link_text(p["linkedin"], "LinkedIn") + r"}} $|$ "
            r"\faGithub\hspace{0.01cm} \href{" + p["github"] + "}{\\underline{" + link_text(p["github"], "Github") + r"}}"
            r"\end{center}")
    edu = r"\section{Education}\resumeSubHeadingListStart" + "".join(
        r"\resumeSubheading{" + tex(d["school"]) + "}{" + tex(d["start"]) + " -- " + tex(d["end"]) + "}{"
        + tex(d["degree_text"]) + (" GPA: " + tex(d["gpa"]) if d["gpa"] else "") + "}{" + tex(d["place"]) + "}"
        for d in p["education"]) + r"\resumeSubHeadingListEnd"
    exp = r"\section{Experience}\resumeSubHeadingListStart" + "".join(
        r"\resumeSubheading{" + tex(x["title"]) + "}{" + tex(x["start"]) + " -- " + tex(x["end"]) + "}{"
        + tex(x["company"]) + "}{" + tex(x["place"]) + r"}\resumeItemListStart"
        + "".join(r"\resumeItem{" + tex(b) + "}" for b in x["bullets"]) + r"\resumeItemListEnd"
        for x in p["experience"]) + r"\resumeSubHeadingListEnd"
    skills = r"\section{Technical Skills}" + tex(p["skills"])
    return preamble + r"\begin{document}" + head + edu + exp + skills + r"\end{document}"


def latex_plain(p):
    def url(u, label):
        return r"\href{" + u + "}{" + (tex(re.sub(r"^https?://(www\.)?", "", u)) if p["links_as_text"] else label) + "}"
    body = (r"\begin{center}{\LARGE\bfseries " + tex(p["name"]) + r"}\\[2pt]" + tex(p["phone"]) + r" \quad "
            + tex(p["email"]) + r" \quad " + url(p["linkedin"], "LinkedIn") + r" \quad " + url(p["github"], "GitHub")
            + r"\end{center}")
    body += r"\section*{Education}" + "".join(
        r"\textbf{" + tex(d["school"]) + r"} \hfill " + tex(d["place"]) + r"\\ \textit{" + tex(d["degree_text"])
        + r"} \hfill " + tex(d["start"]) + " -- " + tex(d["end"])
        + (r"\\ GPA: " + tex(d["gpa"]) if d["gpa"] else "") + r"\par\medskip " for d in p["education"])
    body += r"\section*{Experience}" + "".join(
        r"\textbf{" + tex(x["company"]) + r"} \hfill " + tex(x["place"]) + r"\\ \textit{" + tex(x["title"])
        + r"} \hfill " + tex(x["start"]) + " -- " + tex(x["end"])
        + r"\begin{itemize}\setlength\itemsep{0pt}" + "".join(r"\item " + tex(b) for b in x["bullets"])
        + r"\end{itemize}" for x in p["experience"])
    body += r"\section*{Skills}" + tex(p["skills"])
    return (r"\documentclass[10pt]{article}\usepackage[margin=0.7in]{geometry}\usepackage[hidelinks]{hyperref}"
            r"\usepackage[T1]{fontenc}\pagestyle{empty}\setlength\parindent{0pt}\begin{document}" + body + r"\end{document}")


LATEX_LAYOUTS = {"latex-template": latex_template, "latex-plain": latex_plain}

# ------------------------------------------------------------------- truth

def truth(p, pdf_name):
    first, *_, last = p["name"].split()
    return {
        "file": pdf_name, "layout": p["layout"],
        "fields": {"full_name": [p["name"]], "first_name": [first], "last_name": [last],
                   "email": [p["email"]], "phone": [p["phone"]],
                   "linkedin": [p["linkedin"]], "github": [p["github"]]},
        "education": [{"school": [d["school"]], "degree": d["degree_ok"], "major": [d["major"]],
                       "gpa": [d["gpa"]] if d["gpa"] else [], "start_date": [d["start"]], "end_date": [d["end"]]}
                      for d in p["education"]],
        "experience": [{"company": [x["company"]], "title": [x["title"]], "location": [x["place"]],
                        "start_date": [x["start"]], "end_date": [x["end"]], "bullets": x["bullets"]}
                       for x in p["experience"]],
    }


AIDAN = {
    "file": "aidan-obrien-real.pdf", "layout": "real (LaTeX)",
    "fields": {"full_name": ["Aidan O'Brien", "Aidan O’Brien"], "first_name": ["Aidan"],
               "last_name": ["O'Brien", "O’Brien"], "email": ["aidanobrien5599@gmail.com"],
               "phone": ["908-216-0389"], "linkedin": ["https://www.linkedin.com/in/aidanobrien5599"],
               "github": ["https://github.com/aidanobrien5599"]},
    "education": [{"school": ["University of Wisconsin - Madison"], "degree": ["Bachelor of Science", "B.S.", "BS"],
                   "major": ["Computer Science"], "gpa": ["3.9/4.00"], "start_date": ["Sep 2023"],
                   "end_date": ["May 2027"]}],
    "experience": [
        {"company": ["Netflix"], "title": ["Software Engineer Intern"], "location": ["Los Gatos, CA"],
         "start_date": ["May 2026"], "end_date": ["August 2026"], "bullets": [
            "Drove $15M+ in projected savings by leading a UX-focused A/B test",
            "Architected a cross-repo migration unifying Change Plan routing",
            "Pioneered monitoring-as-code for my team's backend services",
            "Patched a critical regex bug on cssjanus"]},
        {"company": ["Intelligible AI"], "title": ["Founding Engineer"], "location": ["Remote"],
         "start_date": ["Dec 2025"], "end_date": ["May 2026"], "bullets": [
            "Built the data ingestion pipelines for the first 4 database connectors",
            "Integrated Fivetran Connect Card with a webhook-driven sync lifecycle",
            "Led migration of infrastructure-as-code from AWS CDK to SST"]},
        {"company": ["CargoLabs"], "title": ["Software Engineer Intern"], "location": ["Remote"],
         "start_date": ["June 2025"], "end_date": ["Aug 2025"], "bullets": [
            "Eliminated 8+ hours/month of manual work by automating bordereau reporting",
            "Standardized authentication pipelines across 7 AWS Cognito user pools",
            "Built a comprehensive customer service portal"]},
    ],
}

# ------------------------------------------------------------------- build

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def main():
    for d in (OUT, TRUTH, WORK):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    built = []
    for p in PERSONAS:
        name = f'{p["id"]}-{p["layout"]}.pdf'
        target = OUT / name
        if p["layout"] in HTML_LAYOUTS:
            page = WORK / f'{p["id"]}.html'
            page.write_text(f'<!doctype html><meta charset="utf-8"><style>{CSS}</style>'
                            f'<body>{HTML_LAYOUTS[p["layout"]](p)}</body>')
            run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                 f"--print-to-pdf={target}", page.as_uri()])
        else:
            source = WORK / f'{p["id"]}.tex'
            source.write_text(LATEX_LAYOUTS[p["layout"]](p))
            for _ in range(2):
                result = run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", source.name], cwd=WORK)
            shutil.copy(WORK / f'{p["id"]}.pdf', target) if (WORK / f'{p["id"]}.pdf').exists() else print(result.stdout[-800:])
        if target.exists():
            (TRUTH / f'{p["id"]}-{p["layout"]}.json').write_text(json.dumps(truth(p, name), indent=1))
            built.append(name)

    # A scanned resume: the classic layout, flattened to pixels.
    base = OUT / "maya-chen-classic.pdf"
    png, scanned = WORK / "maya.png", OUT / "maya-chen-scanned.pdf"
    run(["sips", "-s", "format", "png", "-Z", "2200", str(base), "--out", str(png)])
    run(["sips", "-s", "format", "pdf", str(png), "--out", str(scanned)])
    if scanned.exists():
        t = truth(PERSONAS[0], scanned.name)
        t["layout"] = "scanned (image only)"
        (TRUTH / "maya-chen-scanned.json").write_text(json.dumps(t, indent=1))
        built.append(scanned.name)

    shutil.copy(REAL_RESUME, OUT / AIDAN["file"])
    (TRUTH / "aidan-obrien-real.json").write_text(json.dumps(AIDAN, indent=1))
    built.append(AIDAN["file"])
    print(f"{len(built)} resumes:")
    for b in built:
        print("  ", b, f'{(OUT / b).stat().st_size // 1024} KB')


if __name__ == "__main__":
    main()
