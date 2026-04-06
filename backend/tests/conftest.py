"""Root test configuration.

Sets TESTING=true before any app code is imported so that the rate limiter
is disabled for the entire test suite.
"""
import os

# Must be set before app modules are imported (limiter reads it at module load time)
os.environ.setdefault("TESTING", "true")
