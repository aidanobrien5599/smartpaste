"""Synthetic resumes for measuring the drafter. Every person here is invented.

Each persona is both the content that gets rendered and the answer key. The
variation is deliberate: date formats, degree phrasing, section names, entry
order, number of schools and roles, and non-US locations, because each of those
is something a parser tuned on one resume quietly assumes.
"""

PERSONAS = [
    {
        "id": "maya-chen", "layout": "classic",
        "name": "Maya Chen", "email": "maya.chen@example.com", "phone": "(404) 555-0182",
        "linkedin": "https://www.linkedin.com/in/maya-chen-example", "github": "https://github.com/mayachen-example",
        "links_as_text": True,
        "education": [
            {"school": "Georgia Institute of Technology", "place": "Atlanta, GA",
             "degree_text": "B.S. in Computer Science", "degree_ok": ["Bachelor of Science", "B.S.", "BS"],
             "major": "Computer Science", "gpa": "3.82/4.00", "start": "Aug 2022", "end": "May 2026"},
        ],
        "experience": [
            {"company": "Stripe", "title": "Software Engineering Intern", "place": "San Francisco, CA",
             "start": "Jun 2025", "end": "Aug 2025", "bullets": [
                "Built a retry scheduler for failed webhook deliveries that cut merchant-visible failures by 31%",
                "Migrated the dispute evidence uploader from a cron job to an event-driven Kafka consumer",
                "Wrote the runbook and alerting for the new pipeline, adopted by two other teams"]},
            {"company": "Georgia Tech Research Institute", "title": "Undergraduate Researcher", "place": "Atlanta, GA",
             "start": "Jan 2024", "end": "May 2025", "bullets": [
                "Trained a YOLOv8 model on 40k labelled drone frames for runway debris detection",
                "Reduced inference latency on a Jetson Orin from 90ms to 34ms with TensorRT quantization"]},
        ],
        "skills": "Python, Go, TypeScript, Kafka, PostgreSQL, PyTorch",
    },
    {
        "id": "daniel-okafor", "layout": "sidebar",
        "name": "Daniel Okafor", "email": "d.okafor@example.com", "phone": "+1 416 555 0199",
        "linkedin": "https://www.linkedin.com/in/daniel-okafor-example", "github": "https://github.com/dokafor-example",
        "links_as_text": False,
        "education": [
            {"school": "University of Toronto", "place": "Toronto, ON",
             "degree_text": "Bachelor of Applied Science, Engineering Science",
             "degree_ok": ["Bachelor of Applied Science", "BASc"], "major": "Engineering Science",
             "gpa": "3.74/4.00", "start": "Sep 2021", "end": "Apr 2026"},
        ],
        "experience": [
            {"company": "Wealthsimple", "title": "Backend Developer Intern", "place": "Toronto, ON",
             "start": "Jan 2025", "end": "Apr 2025", "bullets": [
                "Rewrote the tax-slip generation job in Rust, cutting the year-end batch from 9 hours to 50 minutes",
                "Added idempotency keys to the transfers API after tracing a double-deposit incident"]},
            {"company": "Shopify", "title": "Software Developer Intern", "place": "Ottawa, ON",
             "start": "May 2024", "end": "Dec 2024", "bullets": [
                "Shipped bulk editing for product variants to 1.2M merchants behind a staged rollout",
                "Profiled and fixed an N+1 query in the admin GraphQL layer that dominated p99 latency",
                "Mentored two first-term interns through their first production deploys"]},
        ],
        "skills": "Ruby, Rust, React, GraphQL, MySQL",
    },
    {
        "id": "priya-raman", "layout": "dates-left",
        "name": "Priya Raman", "email": "priya.raman@example.com", "phone": "+1 412 555 0134",
        "linkedin": "https://www.linkedin.com/in/priya-raman-example", "github": "https://github.com/praman-example",
        "links_as_text": True,
        "education": [
            {"school": "Carnegie Mellon University", "place": "Pittsburgh, PA",
             "degree_text": "M.S. in Computer Science", "degree_ok": ["Master of Science", "M.S.", "MS"],
             "major": "Computer Science", "gpa": "3.93/4.00", "start": "08/2024", "end": "12/2025"},
            {"school": "Indian Institute of Technology Madras", "place": "Chennai, India",
             "degree_text": "B.Tech in Computer Science and Engineering",
             "degree_ok": ["Bachelor of Technology", "B.Tech"], "major": "Computer Science and Engineering",
             "gpa": "9.1/10", "start": "07/2019", "end": "05/2023"},
        ],
        "experience": [
            {"company": "Amazon", "title": "Software Development Engineer Intern", "place": "Seattle, WA",
             "start": "05/2025", "end": "08/2025", "bullets": [
                "Designed a sharded cache in front of the seller-inventory service, absorbing 60% of read traffic",
                "Load-tested the design to 40k requests per second and wrote the launch readiness review"]},
            {"company": "Flipkart", "title": "Software Engineer", "place": "Bengaluru, India",
             "start": "07/2023", "end": "07/2024", "bullets": [
                "Owned the order-promise estimator used on every product page during Big Billion Days",
                "Cut estimator cold-start time from 14s to 2s by precomputing warehouse lead-time tables",
                "Led the migration of three services from a monorepo build to Bazel"]},
        ],
        "skills": "Java, Kotlin, Python, DynamoDB, Redis, Bazel",
    },
    {
        "id": "lucas-moreau", "layout": "table",
        "name": "Lucas Moreau", "email": "lucas.moreau@example.com", "phone": "(510) 555-0147",
        "linkedin": "https://www.linkedin.com/in/lucas-moreau-example", "github": "https://github.com/lmoreau-example",
        "links_as_text": True,
        "education": [
            {"school": "University of California, Berkeley", "place": "Berkeley, CA",
             "degree_text": "B.A. Computer Science and Economics",
             "degree_ok": ["Bachelor of Arts", "B.A.", "BA"], "major": "Computer Science and Economics",
             "gpa": "3.61", "start": "Aug 2022", "end": "May 2026"},
        ],
        "experience": [
            {"company": "UC Berkeley EECS", "title": "Undergraduate Student Instructor", "place": "Berkeley, CA",
             "start": "Aug 2024", "end": "Present", "bullets": [
                "Teach two weekly discussion sections of 35 students for CS 61B Data Structures",
                "Wrote autograder tests for four projects used by 1,400 students"]},
            {"company": "Robinhood", "title": "Software Engineering Intern", "place": "Menlo Park, CA",
             "start": "Summer 2025", "end": "Summer 2025", "bullets": [
                "Built a reconciliation service comparing ledger balances against clearing-firm statements nightly",
                "Surfaced 14 historical breaks that finance had been correcting by hand"]},
        ],
        "skills": "Python, Java, SQL, Airflow, dbt",
    },
    {
        "id": "sofia-alvarez", "layout": "latex-template",
        "name": "Sofia Alvarez", "email": "sofia.alvarez@example.com", "phone": "734-555-0166",
        "linkedin": "https://www.linkedin.com/in/sofia-alvarez-example", "github": "https://github.com/salvarez-example",
        "links_as_text": False,
        "education": [
            {"school": "University of Michigan", "place": "Ann Arbor, MI",
             "degree_text": "BSE Computer Engineering", "degree_ok": ["Bachelor of Science in Engineering", "BSE"],
             "major": "Computer Engineering", "gpa": "3.91/4.00", "start": "Sep 2022", "end": "Apr 2026"},
        ],
        "experience": [
            {"company": "Michigan Hackers", "title": "President", "place": "Ann Arbor, MI",
             "start": "Sep 2024", "end": "Present", "bullets": [
                "Run weekly workshops for a 300-member student club and organise the annual hackathon"]},
            {"company": "Ford Motor Company", "title": "Software Engineering Intern", "place": "Dearborn, MI",
             "start": "May 2025", "end": "Aug 2025", "bullets": [
                "Built a CAN-bus log replay tool that let firmware engineers reproduce field faults on a bench",
                "Cut replay setup from a day of manual wiring to a ten-minute scripted run"]},
            {"company": "Qualcomm", "title": "Embedded Software Intern", "place": "San Diego, CA",
             "start": "May 2024", "end": "Aug 2024", "bullets": [
                "Ported a sensor-fusion driver to a new DSP and closed out 23 hardware bring-up bugs",
                "Wrote a power-measurement harness that became the team's regression gate"]},
        ],
        "skills": "C, C++, Python, embedded Linux, CAN, FreeRTOS",
    },
    {
        "id": "james-whitaker", "layout": "renamed",
        "name": "James Whitaker", "email": "j.whitaker@example.co.uk", "phone": "+44 7700 900123",
        "linkedin": "https://www.linkedin.com/in/james-whitaker-example", "github": "https://github.com/jwhitaker-example",
        "links_as_text": False,
        "education": [
            {"school": "Imperial College London", "place": "London, UK",
             "degree_text": "MEng Computing", "degree_ok": ["Master of Engineering", "MEng"],
             "major": "Computing", "gpa": "", "start": "Oct 2021", "end": "Jun 2025"},
        ],
        "experience": [
            {"company": "Bloomberg", "title": "Software Engineer Intern", "place": "London, UK",
             "start": "Jul 2024", "end": "Sep 2024", "bullets": [
                "Added streaming backfill to the market-data normaliser so late ticks no longer dropped silently",
                "Reduced memory use of the tick buffer by 40% by switching to an arena allocator"]},
            {"company": "Monzo", "title": "Backend Engineering Intern", "place": "London, UK",
             "start": "Jun 2023", "end": "Sep 2023", "bullets": [
                "Built a Go service that flags duplicate card authorisations before they reach settlement",
                "Wrote the chaos test that caught a race in the ledger's idempotency check"]},
        ],
        "skills": "Go, C++, Kotlin, Cassandra, Kubernetes",
    },
    {
        "id": "hannah-park", "layout": "experience-first",
        "name": "Hannah Park", "email": "hannah.park@example.com", "phone": "617-555-0121",
        "linkedin": "https://www.linkedin.com/in/hannah-park-example", "github": "https://github.com/hpark-example",
        "links_as_text": True,
        "education": [
            {"school": "Northeastern University", "place": "Boston, MA",
             "degree_text": "Bachelor of Science in Data Science", "degree_ok": ["Bachelor of Science", "BS", "B.S."],
             "major": "Data Science", "gpa": "3.70", "start": "Sep 2021", "end": "May 2026"},
        ],
        "experience": [
            {"company": "HubSpot", "title": "Software Engineering Co-op", "place": "Cambridge, MA",
             "start": "Jul 2025", "end": "Dec 2025", "bullets": [
                "Built the lead-scoring feature store backing the CRM's predictive contact score",
                "Cut model retraining time from six hours to 40 minutes by caching feature joins"]},
            {"company": "Wayfair", "title": "Data Science Co-op", "place": "Boston, MA",
             "start": "Jan 2024", "end": "Jun 2024", "bullets": [
                "Ran a pricing experiment on 80k SKUs and wrote the analysis that shipped to all furniture categories",
                "Replaced a hand-tuned demand forecast with a gradient-boosted model, lowering MAPE by 11 points"]},
        ],
        "skills": "Python, SQL, Spark, XGBoost, Looker",
    },
    {
        "id": "marcus-johnson", "layout": "latex-plain",
        "name": "Marcus Johnson", "email": "marcus.johnson@example.com", "phone": "(202) 555-0113",
        "linkedin": "https://www.linkedin.com/in/marcus-johnson-example", "github": "https://github.com/mjohnson-example",
        "links_as_text": True,
        "education": [
            {"school": "Howard University", "place": "Washington, DC",
             "degree_text": "B.S. Computer Science", "degree_ok": ["Bachelor of Science", "B.S.", "BS"],
             "major": "Computer Science", "gpa": "3.52/4.00", "start": "Aug 2022", "end": "May 2026"},
        ],
        "experience": [
            {"company": "Microsoft", "title": "Software Engineer Intern", "place": "Redmond, WA",
             "start": "May 2025", "end": "Aug 2025", "bullets": [
                "Built a flaky-test quarantine bot for the Azure Storage CI pipeline",
                "Cut median pull-request queue time by 18 minutes across a 400-engineer org"]},
            {"company": "Google", "title": "STEP Intern", "place": "Mountain View, CA",
             "start": "May 2024", "end": "Aug 2024", "bullets": [
                "Added offline support to an internal Android field-inspection app",
                "Wrote the sync-conflict resolution logic and its property-based tests"]},
        ],
        "skills": "Java, C#, Kotlin, Android, Azure",
    },
    {
        "id": "elena-petrova", "layout": "stacked",
        "name": "Elena Petrova", "email": "elena.petrova@example.com", "phone": "+1 519 555 0158",
        "linkedin": "https://www.linkedin.com/in/elena-petrova-example", "github": "https://github.com/epetrova-example",
        "links_as_text": True,
        "education": [
            {"school": "University of Waterloo", "place": "Waterloo, ON",
             "degree_text": "Bachelor of Mathematics, Computer Science", "degree_ok": ["Bachelor of Mathematics", "BMath"],
             "major": "Computer Science", "gpa": "", "start": "Sep 2021", "end": "Apr 2026"},
        ],
        "experience": [
            {"company": "Databricks", "title": "Software Engineer Intern", "place": "San Francisco, CA",
             "start": "Jan 2025", "end": "Apr 2025", "bullets": [
                "Implemented predicate pushdown for nested struct columns in the Photon scan operator"]},
            {"company": "Snowflake", "title": "Software Engineer Intern", "place": "San Mateo, CA",
             "start": "May 2024", "end": "Aug 2024", "bullets": [
                "Built a cost-based rule that rewrites correlated subqueries into semi-joins"]},
            {"company": "Cohere", "title": "Machine Learning Engineer Intern", "place": "Toronto, ON",
             "start": "Sep 2023", "end": "Dec 2023", "bullets": [
                "Wrote the evaluation harness for multilingual retrieval across 18 languages"]},
            {"company": "Faire", "title": "Software Engineer Intern", "place": "Kitchener, ON",
             "start": "Jan 2023", "end": "Apr 2023", "bullets": [
                "Shipped wholesale order splitting across multiple warehouses"]},
        ],
        "skills": "Scala, Java, Python, Spark, SQL",
    },
    {
        "id": "noah-kim", "layout": "classic",
        "name": "Noah Kim", "email": "noah.kim@example.com", "phone": "(310) 555-0172",
        "linkedin": "https://www.linkedin.com/in/noah-kim-example", "github": "https://github.com/nkim-example",
        "links_as_text": False,
        "education": [
            {"school": "University of California, Los Angeles", "place": "Los Angeles, CA",
             "degree_text": "B.S. Computer Science", "degree_ok": ["Bachelor of Science", "B.S.", "BS"],
             "major": "Computer Science", "gpa": "3.68/4.00", "start": "Sep 2024", "end": "Jun 2026"},
            {"school": "Santa Monica College", "place": "Santa Monica, CA",
             "degree_text": "A.S. Mathematics", "degree_ok": ["Associate of Science", "A.S.", "AS"],
             "major": "Mathematics", "gpa": "3.95/4.00", "start": "Aug 2022", "end": "May 2024"},
        ],
        "experience": [
            {"company": "Snap Inc.", "title": "Software Engineer Intern", "place": "Los Angeles, CA",
             "start": "Jun 2025", "end": "Sep 2025", "bullets": [
                "Built the server side of a Lens usage dashboard for creator analytics",
                "Cut dashboard query cost by 70% by moving aggregation into a nightly rollup table"]},
            {"company": "Santa Monica College Math Lab", "title": "Math Tutor", "place": "Santa Monica, CA",
             "start": "Sep 2022", "end": "May 2024", "bullets": [
                "Tutored 20 students a week in calculus and linear algebra"]},
        ],
        "skills": "Python, TypeScript, Go, BigQuery, React",
    },
]
