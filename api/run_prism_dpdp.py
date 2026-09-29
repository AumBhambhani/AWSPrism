"""Launch PRISM DPDP Governance Platform.

Usage:
    python run_prism_dpdp.py

Then open: http://localhost:8000
"""

import uvicorn
from prism_dpdp.app import app

if __name__ == "__main__":
    print("=" * 55)
    print("  🛡️  PRISM — Personal Data Discovery & Governance")
    print("=" * 55)
    print()
    print("  Open in browser: http://localhost:8080")
    print()
    print("  Workflow:")
    print("    1. Select departments          → /departments")
    print("    2. Select tools & data          → /tools")
    print("    3. Assess controls & detection  → /assess")
    print("    4. Review recommendations       → /review")
    print()
    print("  API docs: http://localhost:8080/api/docs")
    print("=" * 55)
    uvicorn.run(app, host="0.0.0.0", port=8080)
