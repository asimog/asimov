#!/usr/bin/env python3
"""
Synthetic smoke test for Railway deployment
Tests health endpoint and protected API endpoint
"""
import os
import sys
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_health_endpoint(base_url):
    """Test health endpoint (no auth required)"""
    print(f"Testing health endpoint: {base_url}/health")
    try:
        response = requests.get(f"{base_url}/health", timeout=10)
        if response.status_code == 200:
            print("✓ Health endpoint OK")
            return True
        else:
            print(f"✗ Health endpoint failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Health endpoint error: {e}")
        return False

def test_protected_api(base_url, internal_key):
    """Test protected API endpoint (requires auth)"""
    print(f"Testing protected API: {base_url}/api/graph/ontology/generate")
    
    # Test without auth (should fail)
    print("  Testing without auth (should fail)...")
    try:
        response = requests.post(
            f"{base_url}/api/graph/ontology/generate",
            json={},
            timeout=10
        )
        if response.status_code == 401:
            print("  ✓ Correctly rejected without auth (401)")
        else:
            print(f"  ✗ Unexpected status without auth: {response.status_code}")
            return False
    except Exception as e:
        print(f"  ✗ Error without auth: {e}")
        return False
    
    # Test with auth (should pass or return 400 for missing fields)
    if internal_key:
        print("  Testing with auth (should pass or return 400)...")
        try:
            response = requests.post(
                f"{base_url}/api/graph/ontology/generate",
                json={},
                headers={"x-miroshark-internal-key": internal_key},
                timeout=10
            )
            if response.status_code in [200, 400]:
                print(f"  ✓ Auth accepted (status: {response.status_code})")
                return True
            else:
                print(f"  ✗ Unexpected status with auth: {response.status_code}")
                return False
        except Exception as e:
            print(f"  ✗ Error with auth: {e}")
            return False
    else:
        print("  ⚠ Skipping auth test (MIROSHARK_INTERNAL_KEY not set)")
        return True

def test_openapi_docs(base_url):
    """Test OpenAPI docs endpoint (no auth required)"""
    print(f"Testing OpenAPI docs: {base_url}/api/docs")
    try:
        response = requests.get(f"{base_url}/api/docs", timeout=10)
        if response.status_code == 200:
            print("✓ OpenAPI docs accessible")
            return True
        else:
            print(f"✗ OpenAPI docs failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ OpenAPI docs error: {e}")
        return False

def main():
    """Run all smoke tests"""
    base_url = os.environ.get("SMOKE_TEST_URL", "http://localhost:8080")
    internal_key = os.environ.get("MIROSHARK_INTERNAL_KEY", "")
    
    print(f"Running smoke tests against: {base_url}")
    print("=" * 50)
    
    results = []
    results.append(("Health", test_health_endpoint(base_url)))
    results.append(("Protected API", test_protected_api(base_url, internal_key)))
    results.append(("OpenAPI Docs", test_openapi_docs(base_url)))
    
    print("=" * 50)
    print("Results:")
    for name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {name}: {status}")
    
    all_passed = all(result[1] for result in results)
    if all_passed:
        print("\n✓ All smoke tests passed")
        return 0
    else:
        print("\n✗ Some smoke tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
