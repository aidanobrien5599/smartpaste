"""Convert ResumeExtractBench (Careerflow, CC-BY-4.0) into this corpus's truth format.

    python3 corpus/external/import_bench.py

https://huggingface.co/datasets/Careerflow/ResumeExtractBench -- 38 resumes,
fictional people, human-verified ground truth. The PDFs and ground truth are
downloaded locally and kept out of git; this script only converts.
"""

import json
import pathlib

HERE = pathlib.Path(__file__).parent / "resumeextractbench"
OUT = HERE / "truth"
MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# The benchmark records a degree as written ("M.S."); accept the spelled-out
# form too, since that is what a drafter ought to produce.
DEGREES = {
    "b.s.": "Bachelor of Science", "bs": "Bachelor of Science", "b.sc.": "Bachelor of Science",
    "bsc": "Bachelor of Science", "b.a.": "Bachelor of Arts", "ba": "Bachelor of Arts",
    "m.s.": "Master of Science", "ms": "Master of Science", "m.sc.": "Master of Science",
    "m.a.": "Master of Arts", "ma": "Master of Arts", "mba": "Master of Business Administration",
    "ph.d.": "Doctor of Philosophy", "phd": "Doctor of Philosophy", "m.d.": "Doctor of Medicine",
    "md": "Doctor of Medicine", "j.d.": "Juris Doctor", "jd": "Juris Doctor",
}


def date(month, year, current=False):
    if current:
        return ["Present", "Current", "Now"]
    if not year:
        return []
    return [f"{MONTHS[month]} {year}", str(year)] if month else [str(year)]


def degree(study):
    if not study:
        return []
    full = DEGREES.get(study.strip().lower())
    return [study] + ([full] if full else [])


def main():
    OUT.mkdir(exist_ok=True)
    for line in (HERE / "test.jsonl").read_text().splitlines():
        row = json.loads(line)
        g = row["ground_truth"]
        b = g["basics"]
        full = " ".join(x for x in (b.get("fname"), b.get("lname")) if x)
        truth = {
            "file": "external/resumeextractbench/" + row["files"]["pdf"],
            "layout": row["source"], "tags": row["layout_tags"],
            "fields": {
                "full_name": [full] if full else [],
                "first_name": [b["fname"]] if b.get("fname") else [],
                "last_name": [b["lname"]] if b.get("lname") else [],
                "email": [b["email"]] if b.get("email") else [],
                "phone": [b["phone"]] if b.get("phone") else [],
                "linkedin": [], "github": [],
            },
            "education": [{
                "school": [e["institution"]] if e.get("institution") else [],
                "degree": degree(e.get("studyType")),
                "major": [e["area"]] if e.get("area") else [],
                "gpa": [e["score"].replace("GPA:", "").strip(), e["score"]] if e.get("score") else [],
                "start_date": date(e.get("startMonth"), e.get("startYear")),
                "end_date": date(e.get("endMonth"), e.get("endYear"), e.get("currentlyStudyHere")),
            } for e in g.get("education", [])],
            "experience": [{
                "company": [x["company"]] if x.get("company") else [],
                "title": [x["position"]] if x.get("position") else [],
                "location": [x["city"]] if x.get("city") else [],
                "start_date": date(x.get("startMonth"), x.get("startYear")),
                "end_date": date(x.get("endMonth"), x.get("endYear"), x.get("currentlyWorkHere")),
                "bullets": x.get("description") or [],
            } for x in g.get("experience", [])],
        }
        (OUT / f'{row["resume_id"]}.json').write_text(json.dumps(truth, indent=1))
    print(len(list(OUT.glob("*.json"))), "truth files written to", OUT.relative_to(pathlib.Path.cwd()))


if __name__ == "__main__":
    main()
