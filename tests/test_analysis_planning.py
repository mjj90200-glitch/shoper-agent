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

    def test_project_payload_over_two_megabytes_is_rejected(self):
        with TemporaryDirectory() as directory:
            service = AnalysisProjectService()
            service.configure_database(Path(directory) / "state.sqlite")
            project = {
                "id": "2bc87f17-65fd-4074-8da6-0aa6e6ee0c45",
                "title": "超大分析",
                "goal": "验证持久化边界",
                "status": "complete",
                "runs": [{"result": "数" * 1_100_000}],
                "createdAt": 1,
                "updatedAt": 1,
            }

            with self.assertRaisesRegex(ValueError, "2MB"):
                service.save("alice", project)

    def test_running_project_rejects_stale_client_snapshot(self):
        with TemporaryDirectory() as directory:
            service = AnalysisProjectService()
            service.configure_database(Path(directory) / "state.sqlite")
            running = {
                "id": "2bc87f17-65fd-4074-8da6-0aa6e6ee0c45",
                "title": "地区分析",
                "goal": "分析地区销售",
                "status": "running",
                "runs": [{"stepId": "region", "status": "running"}],
                "createdAt": 1,
                "updatedAt": 3,
            }
            service.save("alice", running)

            returned = service.save_from_client(
                "alice", {**running, "status": "review", "runs": [], "updatedAt": 2}
            )

            self.assertEqual(returned, running)
            self.assertEqual(service.get("alice", running["id"]), running)

    def test_interrupted_running_projects_become_resumable(self):
        with TemporaryDirectory() as directory:
            service = AnalysisProjectService()
            service.configure_database(Path(directory) / "state.sqlite")
            project = {
                "id": "2bc87f17-65fd-4074-8da6-0aa6e6ee0c45",
                "title": "地区分析",
                "goal": "分析地区销售",
                "status": "running",
                "runs": [
                    {"stepId": "region", "status": "running", "error": "旧错误"},
                    {"stepId": "trend", "status": "done"},
                ],
                "createdAt": 1,
                "updatedAt": 3,
            }
            service.save("alice", project)

            self.assertEqual(service.recover_interrupted(), 1)
            recovered = service.get("alice", project["id"])
            self.assertEqual(recovered["status"], "review")
            self.assertEqual(recovered["runs"][0]["status"], "pending")
            self.assertIsNone(recovered["runs"][0]["error"])
            self.assertEqual(recovered["runs"][1]["status"], "done")


if __name__ == "__main__":
    unittest.main()
