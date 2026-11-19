"""Select the in-app interaction surface for Serphia PPT Studio projects."""

import os
from pathlib import Path


def uses_studio(project):
    directory = Path(project).resolve()
    return any(
        parent.name == "presentations" and parent.parent.name == ".serphia"
        for parent in (directory, *directory.parents)
    )


def studio_ui_handoff(project, service, args):
    """Leave cleanup and non-interactive rendering available to existing projects."""
    if args.shutdown:
        return None
    if os.getenv("SERPHIA_PPT_STUDIO") != "1" and not (uses_studio(project) or uses_studio(Path.cwd())):
        return None
    if service == "svg_editor" and args.no_browser and not args.live:
        return None

    if service == "confirm_ui":
        # Keep the upstream form and receipt/wait protocol, but embed it in Studio.
        args.no_browser = True
        return None
    if service == "spec_review":
        return "Review the design spec and collect revisions in the PPT Studio conversation."
    return "Use the editable PPTX pane in PPT Studio for preview and editing."
