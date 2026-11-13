import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from django.conf import settings


@dataclass
class SkillDoc:
    name: str
    description: str
    content: str
    path: str


def _skill_dir() -> str:
    return str(getattr(settings, "AI_SKILLS_DIR", "skills"))


def _skill_path(skill_name: str) -> Optional[str]:
    if not isinstance(skill_name, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]+", skill_name):
        return None
    if skill_name in {".", ".."}:
        return None
    base = Path(_skill_dir()).resolve()
    path = (base / skill_name).resolve()
    if path.parent != base:
        return None
    return str(path)


def _find_skill_file(skill_path: str) -> Optional[str]:
    base = Path(_skill_dir()).resolve()
    candidates = [
        os.path.join(skill_path, "SKILL.md"),
        os.path.join(skill_path, "skill.md"),
        os.path.join(skill_path, "README.md"),
        os.path.join(skill_path, "readme.md"),
    ]
    for c in candidates:
        if os.path.isfile(c) and Path(c).resolve().is_relative_to(base):
            return c
    return None


def _parse_front_matter(content: str) -> Tuple[str, str, str]:
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) == 3:
            fm = parts[1]
            body = parts[2].lstrip("\n")
            name = ""
            desc = ""
            for line in fm.splitlines():
                line = line.strip()
                if line.startswith("name:"):
                    name = line.split(":", 1)[1].strip().strip("\"'")
                if line.startswith("description:"):
                    desc = line.split(":", 1)[1].strip().strip("\"'")
            return name, desc, body
    return "", "", content


def list_skills() -> List[str]:
    base = _skill_dir()
    if not os.path.isdir(base):
        return []
    skills: List[str] = []
    for entry in os.listdir(base):
        full = _skill_path(entry)
        if not full or not os.path.isdir(full):
            continue
        if _find_skill_file(full):
            skills.append(entry)
    skills.sort()
    return skills


def read_skill(skill_name: str) -> Optional[SkillDoc]:
    skill_path = _skill_path(skill_name)
    if not skill_path or not os.path.isdir(skill_path):
        return None
    skill_file = _find_skill_file(skill_path)
    if not skill_file:
        return None
    with open(skill_file, "r", encoding="utf-8") as f:
        raw = f.read()
    name, desc, body = _parse_front_matter(raw)
    name = name or skill_name
    body = body.strip()
    if not desc:
        # Attempt to derive description from first heading.
        m = re.search(r"^#\s+(.+)$", body, flags=re.MULTILINE)
        if m:
            desc = m.group(1).strip()
    if not body:
        body = desc
    return SkillDoc(name=name, description=desc or "", content=body, path=skill_path)


def read_skill_metadata(skill_name: str) -> Optional[SkillDoc]:
    """Read only bounded front matter, without loading the skill body."""
    skill_path = _skill_path(skill_name)
    if not skill_path or not os.path.isdir(skill_path):
        return None
    skill_file = _find_skill_file(skill_path)
    if not skill_file:
        return None
    with open(skill_file, "r", encoding="utf-8") as source:
        first = source.readline(1024).lstrip("\ufeff")
        if first.strip() != "---":
            description = first.lstrip("# ").strip() if first.startswith("#") else ""
            return SkillDoc(skill_name, description[:500], "", skill_path)
        lines = [first]
        for _ in range(32):
            line = source.readline(1024)
            if not line:
                break
            lines.append(line)
            if line.strip() == "---":
                name, description, _ = _parse_front_matter("".join(lines))
                return SkillDoc(name or skill_name, description[:500], "", skill_path)
    return SkillDoc(skill_name, "", "", skill_path)


def read_skill_content(skill_name: str) -> Optional[str]:
    skill_path = _skill_path(skill_name)
    if not skill_path or not os.path.isdir(skill_path):
        return None
    skill_file = _find_skill_file(skill_path)
    if not skill_file:
        return None
    with open(skill_file, "r", encoding="utf-8") as f:
        return f.read()


def write_skill_content(
    skill_name: str,
    content: str,
    title: str = "",
    description: str = "",
) -> str:
    skill_path = _skill_path(skill_name)
    if not skill_path:
        raise ValueError("Invalid skill name or path")
    os.makedirs(skill_path, exist_ok=True)
    target = os.path.join(skill_path, "SKILL.md")
    if not Path(target).resolve().is_relative_to(Path(_skill_dir()).resolve()):
        raise ValueError("Invalid skill file path")

    body = content or ""
    body = body.lstrip("\ufeff")
    if body.strip().startswith("---"):
        payload = body
    else:
        front_matter = ""
        if title or description:
            safe_title = (title or "").replace("\n", " ").strip()
            safe_desc = (description or "").replace("\n", " ").strip()
            front_matter = "---\n"
            if safe_title:
                front_matter += f"name: \"{safe_title}\"\n"
            if safe_desc:
                front_matter += f"description: \"{safe_desc}\"\n"
            front_matter += "---\n\n"
        payload = f"{front_matter}{body}".strip() + "\n"

    with open(target, "w", encoding="utf-8") as f:
        f.write(payload)
    return target
