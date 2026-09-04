import urllib.request
import urllib.error
import sys

def test_proxy():
    url = "http://localhost:8080/api/audio-proxy?url=https://p.scdn.co/mp3-preview/660d7b530a9e3ce931361e4a1c55fc32cb6ccbaa"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"Status: {resp.status}")
            assert resp.status == 200, f"Expected status 200, got {resp.status}"
            
            cors = resp.headers.get("Access-Control-Allow-Origin")
            print(f"Access-Control-Allow-Origin: {cors}")
            assert cors == "*", f"Expected '*', got '{cors}'"
            
            content_type = resp.headers.get("Content-Type", "")
            print(f"Content-Type: {content_type}")
            assert "audio/mpeg" in content_type, f"Expected 'audio/mpeg' in Content-Type, got '{content_type}'"
            
            chunk = resp.read(1024)
            print(f"Read bytes length: {len(chunk)}")
            assert len(chunk) == 1024, f"Expected 1024 bytes, got {len(chunk)}"
            
            print("TEST PASSED")
    except urllib.error.HTTPError as e:
        print(f"HTTPError: {e.code} {e.reason}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    test_proxy()
