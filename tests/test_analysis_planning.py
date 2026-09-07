import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.services.analysis_planning_service import fallback_plan
from app.services.analysis_project_service import AnalysisProjectService


class AnalysisPlanningTests(unittest.TestCase):
    def test_fallback_plan_is_bounded_and_executable(self):
        plan = fallback_plan("分析 2025 年各地区销售表现")

        self.assertGreaterEqual(len(plan.steps), 2)
        self.assertLessEqual(len(plan.steps), 6)
        self.assertTrue(all(step.question for step in plan.steps))
        self.assertTrue(all(step.id for step in plan.steps))

    def test_projects_are_persisted_and_isolated_by_user(self):
        with TemporaryDirectory() as directory:
            service = AnalysisProjectService()
            service.configure_database(Path(directory) / "state.sqlite")
            project = {
                "id": "2bc87f17-65fd-4074-8da6-0aa6e6ee0c45",
                "title": "地区分析",
                "goal": "分析地区销售",
                "status": "draft",
                "runs": [],
                "createdAt": 1,
                "updatedAt": 1,
            }
            service.save("alice", project)
            self.assertEqual(service.list("alice"), [project])
            self.assertEqual(service.list("bob"), [])
            self.assertTrue(service.delete("alice", project["id"]))
            self.assertEqual(service.list("alice"), [])


if __name__ == "__main__":
    unittest.main()
