"""Tests for the parts that run without touching the API."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from smartpaste import answer, fields, fill, jev, profile, triage

RESUME = """
AIDAN O'BRIEN
aob55992@example.com | 555-0142 | github.com/example | Madison, WI

EDUCATION
University of Wisconsin-Madison
BS Computer Science, expected May 2027
GPA: 3.7

EXPERIENCE
- SWE Intern, Netflix (Summer 2026)
  • Built internal tooling for content delivery pipelines
- BadgerBase — course planning tool for UW students
"""


class TestSnippets(unittest.TestCase):
    def test_splits_on_lines_and_inline_separators(self):
        snippets = profile.snippets_from_resume(RESUME)
        values = set(snippets.values())
        self.assertIn("aob55992@example.com", values)
        self.assertIn("555-0142", values)
        self.assertIn("University of Wisconsin-Madison", values)
        self.assertIn("Built internal tooling for content delivery pipelines", values)

    def test_strips_bullet_prefixes(self):
        values = profile.snippets_from_resume("- Shipped a thing\n• Shipped a thing\n")
        self.assertEqual(list(values.values()), ["Shipped a thing"])

    def test_respects_the_255_option_cap(self):
        many = "\n".join(f"line number {i}" for i in range(400))
        self.assertLessEqual(len(profile.snippets_from_resume(many)), 254)

    def test_criteria_always_offer_an_escape(self):
        criteria = profile.as_criteria({"s001": "x"})
        self.assertIn(profile.NONE, criteria)


class TestFieldDetection(unittest.TestCase):
    FORM = """
    Apply for this job
    First name *
    Last name *
    Email *
    Expected graduation date (required)
    Why do you want to work here?
    We are a small team building developer tools for people who ship daily.
    Submit
    """

    def test_finds_labels_and_strips_required_markers(self):
        labels = fields.candidate_labels(self.FORM)
        self.assertIn("Email", labels)
        self.assertIn("Expected graduation date", labels)
        self.assertIn("Why do you want to work here?", labels)

    def test_drops_prose_and_page_chrome(self):
        labels = fields.candidate_labels(self.FORM)
        self.assertNotIn("Submit", labels)
        self.assertNotIn(
            "We are a small team building developer tools for people who ship daily.",
            labels,
        )

    def test_keeps_long_lines_that_are_questions(self):
        long_question = "Q" * 100 + "?"
        self.assertIn(long_question, fields.candidate_labels(long_question))

    def test_keep_confirmed_filters_on_the_noul(self):
        labels = ["Email", "About us"]
        answers = {"is_field_0": {"noul": 0.98}, "is_field_1": {"noul": 0.04}}
        self.assertEqual(fields.keep_confirmed(labels, answers), ["Email"])


class TestResolve(unittest.TestCase):
    SNIPPETS = {
        "s001": "aob55992@example.com | 555-0142 | github.com/example",
        "s002": "expected May 2027",
    }

    def _answer(self, choice, probabilities, confidence):
        return {"choice": choice, "probabilities": probabilities, "confidence": confidence}

    def test_high_confidence_fills_automatically(self):
        out = answer.resolve(
            "Expected graduation date",
            self._answer("s002", {"s002": 0.99, "s001": 0.01}, 0.99),
            self.SNIPPETS,
        )
        self.assertEqual(out["status"], answer.AUTO_FILL)
        self.assertEqual(out["value"], "May 2027")  # refined out of the snippet

    def test_middling_confidence_asks_you_to_pick(self):
        out = answer.resolve(
            "Start date",
            self._answer("s002", {"s002": 0.55, "s001": 0.45}, 0.55),
            self.SNIPPETS,
        )
        self.assertEqual(out["status"], answer.NEEDS_PICK)
        self.assertTrue(out["alternatives"])

    def test_the_escape_option_yields_no_answer(self):
        out = answer.resolve(
            "Salary expectation",
            self._answer(profile.NONE, {profile.NONE: 1.0}, 1.0),
            self.SNIPPETS,
        )
        self.assertEqual(out["status"], answer.NO_ANSWER)
        self.assertIsNone(out["value"])

    def test_low_confidence_never_offers_a_value(self):
        out = answer.resolve(
            "Something odd",
            self._answer("s001", {"s001": 0.3, "s002": 0.3}, 0.3),
            self.SNIPPETS,
        )
        self.assertEqual(out["status"], answer.NO_ANSWER)
        self.assertIsNone(out["value"])

    def test_refine_extracts_the_exact_value_from_a_contact_line(self):
        contact = self.SNIPPETS["s001"]
        self.assertEqual(answer.refine("Email", contact), "aob55992@example.com")
        self.assertEqual(answer.refine("Phone number", contact), "555-0142")
        self.assertEqual(answer.refine("GitHub", contact), "github.com/example")

    def test_refine_leaves_prose_alone(self):
        self.assertEqual(answer.refine("Why us?", "Because I ship."), "Because I ship.")

    def test_refine_splits_a_name_header_and_fixes_its_casing(self):
        self.assertEqual(answer.refine("First name", "AIDAN O'BRIEN"), "Aidan")
        self.assertEqual(answer.refine("Last name", "AIDAN O'BRIEN"), "O'Brien")
        self.assertEqual(answer.refine("Full name", "AIDAN O'BRIEN"), "Aidan O'Brien")

    def test_refine_ignores_name_suffixes_when_splitting(self):
        self.assertEqual(answer.refine("Last name", "Aidan O'Brien Jr."), "O'Brien")

    def test_refine_pulls_a_date_out_of_an_education_line(self):
        line = "BS Computer Science, expected May 2027"
        self.assertEqual(answer.refine("Expected graduation date", line), "May 2027")
        self.assertEqual(answer.refine("Degree", line), "BS Computer Science")

    def test_graduation_date_takes_the_end_of_a_date_range(self):
        line = "University of Wisconsin - Madison Sep 2023 - May 2027"
        self.assertEqual(answer.refine("Expected graduation date", line), "May 2027")
        self.assertEqual(answer.refine("Start date", line), "Sep 2023")

    def test_refine_falls_back_to_the_whole_snippet_when_nothing_matches(self):
        self.assertEqual(answer.refine("First name", "555-0142"), "555-0142")
        self.assertEqual(answer.refine("Email", "no address here"), "no address here")


class TestBatching(unittest.TestCase):
    def test_splits_large_question_maps_and_merges_answers(self):
        calls = []

        def fake_ask(state, questions, model=None):
            calls.append(len(questions))
            return {k: {"noul": 1.0} for k in questions}

        questions = {f"q{i}": jev.noul("x") for i in range(30)}
        answers = jev.ask_batched({}, questions, batch_size=24, _ask=fake_ask)
        self.assertEqual(calls, [24, 6])
        self.assertEqual(len(answers), 30)


class TestFillOrchestration(unittest.TestCase):
    FORM = "First name *\nEmail *\nSalary expectation\n"

    def test_detection_is_asked_against_the_form_not_the_resume(self):
        states = []

        def fake_ask(state, questions, model=None):
            states.append(state)
            if any(k.startswith("is_field_") for k in questions):
                return {k: {"noul": 1.0} for k in questions}
            return {k: {"choice": profile.NONE, "probabilities": {profile.NONE: 1.0},
                        "confidence": 1.0} for k in questions}

        fill.fill(self.FORM, {"snippets": {"s001": "x"}}, _ask=fake_ask)
        self.assertEqual(states[0], self.FORM)
        self.assertEqual(states[1], {"resume_snippets": {"s001": "x"}})

    def test_two_calls_detect_then_answer(self):
        prof = {"snippets": {"s001": "Aidan O'Brien", "s002": "aob@example.com"}}
        calls = []

        def fake_ask(state, questions, model=None):
            calls.append(questions)
            if any(k.startswith("is_field_") for k in questions):
                return {k: {"noul": 1.0} for k in questions}
            return {
                "f0": {"choice": "s001", "probabilities": {"s001": 0.99}, "confidence": 0.99},
                "f1": {"choice": "s002", "probabilities": {"s002": 0.99}, "confidence": 0.99},
                "f2": {"choice": profile.NONE, "probabilities": {profile.NONE: 1.0},
                       "confidence": 1.0},
            }

        results = fill.fill(self.FORM, prof, _ask=fake_ask)
        self.assertEqual(len(calls), 2)
        self.assertEqual([r["status"] for r in results],
                         [answer.AUTO_FILL, answer.AUTO_FILL, answer.NO_ANSWER])
        self.assertEqual(fill.as_block(results),
                         "First name: Aidan\nEmail: aob@example.com")

    def test_no_detected_fields_means_no_second_call(self):
        calls = []

        def fake_ask(state, questions, model=None):
            calls.append(questions)
            return {k: {"noul": 0.0} for k in questions}

        self.assertEqual(fill.fill(self.FORM, {"snippets": {"s001": "x"}},
                                   _ask=fake_ask), [])
        self.assertEqual(len(calls), 1)


class TestTriageRouting(unittest.TestCase):
    GOOD = {
        "eligible": {"noul": 0.97},
        "sponsorship_blocked": {"noul": 0.02},
        "fit": {"score": 3.0},
        "volume": {"score": 1.0},
    }

    def test_clean_posting_is_worth_applying_to(self):
        self.assertEqual(triage.route(self.GOOD)[0], triage.APPLY)

    def test_work_authorization_wins_over_everything(self):
        blocked = {**self.GOOD, "sponsorship_blocked": {"noul": 0.9}}
        self.assertEqual(triage.route(blocked)[0], triage.SKIP)

    def test_high_volume_routes_to_a_warm_intro(self):
        flooded = {**self.GOOD, "volume": {"score": 3.0}}
        decision, why = triage.route(flooded)
        self.assertEqual(decision, triage.WARM)
        self.assertIn("drown", why)

    def test_a_known_contact_beats_the_volume_heuristic(self):
        decision, why = triage.route(self.GOOD, contacts=2)
        self.assertEqual(decision, triage.WARM)
        self.assertIn("2 people", why)

    def test_not_open_to_new_grads_is_a_skip(self):
        senior = {**self.GOOD, "eligible": {"noul": 0.05}}
        self.assertEqual(triage.route(senior)[0], triage.SKIP)

    def test_counts_contacts_by_company_named_in_the_posting(self):
        prof = {"network": {"Anthropic": ["a", "b"], "Netflix": ["c"]}}
        self.assertEqual(triage._contacts_at("Anthropic is hiring", prof), 2)
        self.assertEqual(triage._contacts_at("Stripe is hiring", prof), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)


class TestPdfRepair(unittest.TestCase):
    def test_strips_icon_font_glyphs(self):
        from smartpaste.source import _repair

        self.assertEqual(_repair(" 908-216-0389"), "908-216-0389")
        self.assertEqual(_repair("♀ Portfolio"), "Portfolio")

    def test_restores_the_space_before_a_glued_date(self):
        from smartpaste.source import _repair

        self.assertEqual(
            _repair("University of Wisconsin - MadisonSep 2023 - May 2027"),
            "University of Wisconsin - Madison Sep 2023 - May 2027",
        )
        self.assertEqual(
            _repair("Software Engineer InternMay 2026"),
            "Software Engineer Intern May 2026",
        )

    def test_restores_the_space_inside_a_glued_caps_name(self):
        from smartpaste.source import _repair

        self.assertEqual(_repair("AIDANO’BRIEN"), "AIDAN O’BRIEN")

    def test_leaves_camelcase_technology_names_alone(self):
        from smartpaste.source import _repair

        intact = "Next.js, PostgreSQL, JavaScript, GitHub, PyTorch, MySQL"
        self.assertEqual(_repair(intact), intact)


class TestInstitutionAndGpa(unittest.TestCase):
    EDU = "University of Wisconsin - Madison Sep 2023 - May 2027"
    DEG = "B.S. Computer Science GPA: 3.9/4.00"

    def test_school_drops_the_attendance_range(self):
        self.assertEqual(
            answer.refine("School", self.EDU), "University of Wisconsin - Madison"
        )

    def test_degree_drops_the_gpa_tail(self):
        self.assertEqual(answer.refine("Degree", self.DEG), "B.S. Computer Science")
        self.assertEqual(answer.refine("Discipline", self.DEG), "B.S. Computer Science")

    def test_gpa_is_extracted_as_a_number(self):
        self.assertEqual(answer.refine("Current GPA", self.DEG), "3.9/4.00")

    def test_a_present_range_is_also_stripped(self):
        self.assertEqual(
            answer.refine("University", "Netflix Los Gatos Jun 2025 - Present"),
            "Netflix Los Gatos",
        )


class TestFileFields(unittest.TestCase):
    def test_upload_fields_are_never_offered(self):
        labels = fields.candidate_labels(
            "Resume/CV *\nCover letter\nUpload transcript\nEmail *\n"
        )
        self.assertEqual(labels, ["Email"])

    def test_a_portfolio_url_is_still_a_normal_field(self):
        self.assertFalse(fields.is_file_field("Portfolio"))
        self.assertTrue(fields.is_file_field("Portfolio file"))


class TestGlyphResidue(unittest.TestCase):
    def test_strips_icon_font_residue_welded_to_a_value(self):
        from smartpaste.source import _repair

        self.assertEqual(_repair("/gtbGithub"), "Github")
        self.assertEqual(_repair("/ne908-216-0389"), "908-216-0389")

    def test_leaves_real_paths_and_urls_alone(self):
        from smartpaste.source import _repair

        for intact in ("https://github.com/aidanobrien5599", "GPA: 3.9/4.00"):
            self.assertEqual(_repair(intact), intact)
