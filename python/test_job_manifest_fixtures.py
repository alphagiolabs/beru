"""Load resources/job-manifest-fixtures.json and pin the Job Manifest
envelope contract the Processor accepts (``_load_jobs_manifest``) against
the JS literals (shared/job-manifest.js JOB_MANIFEST_TYPE/JOB_MANIFEST_VERSION).

Python does not normalize job fields: this side of the contract is the
envelope check plus handing the jobs through unchanged.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

import processor  # noqa: E402

FIXTURES = ROOT / "resources" / "job-manifest-fixtures.json"


def _write_manifest(payload):
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    with handle as stream:
        json.dump(payload, stream)
    return handle.name


class JobManifestFixturesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with FIXTURES.open(encoding="utf-8") as handle:
            cls.contract = json.load(handle)

    def test_envelope_literals(self):
        envelope = self.contract["envelope"]
        self.assertEqual(processor.JOB_MANIFEST_TYPE, envelope["type"])
        self.assertEqual(processor.JOB_MANIFEST_VERSION, envelope["version"])

    def test_load_jobs_manifest_accepts_fixture_jobs(self):
        payload = {**self.contract["envelope"], "jobs": self.contract["jobs"]}
        path = _write_manifest(payload)
        try:
            jobs = processor._load_jobs_manifest(path)
        finally:
            os.unlink(path)
        self.assertEqual(len(jobs), 3)
        self.assertEqual(jobs, self.contract["jobs"])

    def test_load_jobs_manifest_rejects_unsupported_version(self):
        payload = {**self.contract["envelope"], "version": 99, "jobs": self.contract["jobs"]}
        path = _write_manifest(payload)
        try:
            with self.assertRaises(ValueError):
                processor._load_jobs_manifest(path)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
