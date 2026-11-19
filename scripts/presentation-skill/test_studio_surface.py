import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from serphia_surface import studio_ui_handoff


class StudioSurfaceTests(unittest.TestCase):
    def setUp(self):
        self.project = Path.cwd() / ".serphia/presentations/session/deck"
        self.interactive = SimpleNamespace(no_browser=False, shutdown=False)

    @patch.dict(os.environ, {"SERPHIA_PPT_STUDIO": "1"})
    def test_session_keeps_the_in_app_surface_even_for_an_external_project(self):
        self.assertIsNone(studio_ui_handoff(Path.cwd(), "confirm_ui", self.interactive))
        self.assertTrue(self.interactive.no_browser)
        for service in ("spec_review", "svg_editor"):
            with self.subTest(service=service):
                self.interactive.no_browser = False
                self.assertIn("PPT Studio", studio_ui_handoff(Path.cwd(), service, self.interactive))

    @patch.dict(os.environ, {"SERPHIA_PPT_STUDIO": ""})
    def test_only_studio_projects_embed_the_form(self):
        self.assertIsNone(studio_ui_handoff(Path.cwd(), "confirm_ui", self.interactive))
        self.assertFalse(self.interactive.no_browser)
        self.assertIsNone(studio_ui_handoff(self.project, "confirm_ui", self.interactive))
        self.assertTrue(self.interactive.no_browser)

    def test_embedded_confirmation_and_headless_rendering_remain_available(self):
        args = SimpleNamespace(no_browser=True, shutdown=False, live=False)
        self.assertIsNone(studio_ui_handoff(self.project, "confirm_ui", args))
        self.assertIsNotNone(studio_ui_handoff(self.project, "spec_review", args))
        self.assertIsNone(studio_ui_handoff(self.project, "svg_editor", args))
        args.live = True
        self.assertIsNotNone(studio_ui_handoff(self.project, "svg_editor", args))

    def test_existing_services_can_be_shut_down_on_resume(self):
        args = SimpleNamespace(no_browser=False, shutdown=True)
        for service in ("confirm_ui", "spec_review", "svg_editor"):
            self.assertIsNone(studio_ui_handoff(self.project, service, args))
