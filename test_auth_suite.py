import urllib.request
import urllib.error
import json
import subprocess
import time
import sys

BASE_URL = 'http://localhost:9092'
ADMIN_EMAIL = 'patchya-w@rmutp.ac.th'
ADMIN_PASS = 'Wave6362549/'
TIMESTAMP = int(time.time())
USER_USERNAME = f'testuser_{TIMESTAMP}'
USER_EMAIL = f'testuser_{TIMESTAMP}@rmutp.ac.th'
USER_PASS = 'Wave6362549/'
USER_NEW_PASS = 'NewSecurePass456!'

passed_tests = 0
failed_tests = 0

def log_section(title):
    print('\n' + '=' * 75)
    print(f'  {title}')
    print('=' * 75)

def run_test(name, fn):
    global passed_tests, failed_tests
    print(f'\n[TEST] {name}...')
    try:
        fn()
        print(f'  \033[92m[PASS]\033[0m {name}')
        passed_tests += 1
    except Exception as e:
        print(f'  \033[91m[FAIL]\033[0m {name}: {e}')
        failed_tests += 1

def request(method, path, data=None, token=None):
    url = f'{BASE_URL}{path}'
    headers = {'Content-Type': 'application/json'} if data is not None else {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    encoded_data = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            body = resp.read().decode('utf-8')
            json_data = json.loads(body) if body else {}
            return status, json_data
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode('utf-8')
        try:
            json_data = json.loads(body) if body else {}
        except Exception:
            json_data = {'raw': body}
        return status, json_data

def get_db_admin_reset_token(email):
    query = f"SELECT reset_password_token FROM admin_users WHERE email='{email}' ORDER BY id DESC LIMIT 1;"
    cmd = ['docker', 'exec', '69-s2-db', 'psql', '-U', 'strapi', '-d', 'strapi', '-t', '-A', '-c', query]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.stdout.strip()

def get_db_user_reset_token(email):
    query = f"SELECT reset_password_token FROM up_users WHERE email='{email}' ORDER BY id DESC LIMIT 1;"
    cmd = ['docker', 'exec', '69-s2-db', 'psql', '-U', 'strapi', '-d', 'strapi', '-t', '-A', '-c', query]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.stdout.strip()

log_section('1. SYSTEM HEALTH & INITIALIZATION PRE-CHECKS')

def test_health():
    status, _ = request('GET', '/_health')
    assert status == 204, f'Expected 204, got {status}'
run_test('Strapi Service Health Check (GET /_health)', test_health)

def test_admin_init():
    status, data = request('GET', '/admin/init')
    assert status == 200, f'Expected 200, got {status}'
    assert 'data' in data, 'Missing data key'
    assert data['data']['hasAdmin'] is True, 'Expected hasAdmin to be true'
run_test('Admin Init Check (GET /admin/init)', test_admin_init)

log_section('2. ADMIN AUTHENTICATION FLOW')

admin_jwt = None

def test_admin_login():
    global admin_jwt
    payload = {'email': ADMIN_EMAIL, 'password': ADMIN_PASS, 'rememberMe': False}
    status, data = request('POST', '/admin/login', payload)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'data' in data and 'token' in data['data'], 'Missing token in login response'
    admin_jwt = data['data']['token']
    assert data['data']['user']['email'] == ADMIN_EMAIL, 'User email mismatch'
    print(f'    Admin Authenticated. Token: {admin_jwt[:25]}...')
run_test('Admin Login (POST /admin/login)', test_admin_login)

def test_admin_profile():
    global admin_jwt
    assert admin_jwt, 'No admin JWT'
    status, data = request('GET', '/admin/users/me', token=admin_jwt)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'data' in data and data['data']['email'] == ADMIN_EMAIL, 'Admin profile email mismatch'
    print(f'    Admin Profile retrieved: ID={data["data"]["id"]}, Email={data["data"]["email"]}')
run_test('Admin Profile (GET /admin/users/me)', test_admin_profile)

def test_admin_forgot_password():
    payload = {'email': ADMIN_EMAIL}
    status, _ = request('POST', '/admin/forgot-password', payload)
    assert status == 204, f'Expected 204, got {status}'
    token = get_db_admin_reset_token(ADMIN_EMAIL)
    assert token, 'Reset token not generated in database'
    print(f'    Admin Reset Token Generated: {token[:20]}...')
run_test('Admin Forgot Password (POST /admin/forgot-password)', test_admin_forgot_password)

def test_admin_reset_password():
    token = get_db_admin_reset_token(ADMIN_EMAIL)
    assert token, 'No reset token found'
    payload = {'resetPasswordToken': token, 'password': ADMIN_PASS}
    status, data = request('POST', '/admin/reset-password', payload)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'data' in data and 'token' in data['data'], 'Missing token in reset password response'
    print('    Admin password reset successful and new token issued.')
run_test('Admin Reset Password (POST /admin/reset-password)', test_admin_reset_password)

log_section('3. USER AUTHENTICATION FLOW (Strapi Users-Permissions Plugin)')

user_jwt = None

def test_user_signup():
    global user_jwt
    payload = {
        'username': USER_USERNAME,
        'email': USER_EMAIL,
        'password': USER_PASS
    }
    status, data = request('POST', '/api/auth/local/register', payload)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'jwt' in data and 'user' in data, 'Missing jwt or user in registration response'
    user_jwt = data['jwt']
    assert data['user']['email'] == USER_EMAIL, 'User email mismatch'
    print(f'    User Registered: ID={data["user"]["id"]}, Username={data["user"]["username"]}')
run_test('User Signup / Registration (POST /api/auth/local/register)', test_user_signup)

def test_user_login():
    global user_jwt
    payload = {'identifier': USER_EMAIL, 'password': USER_PASS}
    status, data = request('POST', '/api/auth/local', payload)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'jwt' in data and 'user' in data, 'Missing jwt in user login response'
    user_jwt = data['jwt']
    assert data['user']['email'] == USER_EMAIL, 'User email mismatch'
    print(f'    User Logged in. Token: {user_jwt[:25]}...')
run_test('User Login (POST /api/auth/local)', test_user_login)

def test_user_profile():
    global user_jwt
    assert user_jwt, 'No user JWT'
    status, data = request('GET', '/api/users/me', token=user_jwt)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert data['email'] == USER_EMAIL, 'User profile email mismatch'
    print(f'    User Profile: ID={data["id"]}, Username={data["username"]}, Email={data["email"]}')
run_test('User Profile (GET /api/users/me)', test_user_profile)

def test_user_forgot_password():
    payload = {'email': USER_EMAIL}
    status, data = request('POST', '/api/auth/forgot-password', payload)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert data.get('ok') is True, f'Expected ok: true, got {data}'
    token = get_db_user_reset_token(USER_EMAIL)
    assert token, 'Reset token was not generated in database'
    print(f'    User Reset Token: {token[:25]}...')
run_test('User Forgot Password (POST /api/auth/forgot-password)', test_user_forgot_password)

def test_user_reset_password():
    token = get_db_user_reset_token(USER_EMAIL)
    assert token, 'No reset token found'
    payload = {
        'code': token,
        'password': USER_NEW_PASS,
        'passwordConfirmation': USER_NEW_PASS
    }
    status, data = request('POST', '/api/auth/reset-password', payload)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'jwt' in data, 'Missing jwt in reset password response'
    print('    User Password reset successfully with code confirmation.')
run_test('User Reset Password (POST /api/auth/reset-password)', test_user_reset_password)

def test_user_login_new_pass():
    global user_jwt
    payload = {'identifier': USER_EMAIL, 'password': USER_NEW_PASS}
    status, data = request('POST', '/api/auth/local', payload)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'jwt' in data, 'Missing jwt on login with new password'
    user_jwt = data['jwt']
    print('    Login with new password succeeded.')
run_test('User Login with New Password (POST /api/auth/local)', test_user_login_new_pass)

def test_user_change_password():
    global user_jwt
    payload = {
        'currentPassword': USER_NEW_PASS,
        'password': USER_PASS,
        'passwordConfirmation': USER_PASS
    }
    status, data = request('POST', '/api/auth/change-password', payload, token=user_jwt)
    assert status == 200, f'Expected 200, got {status}: {data}'
    assert 'jwt' in data, 'Missing jwt in change password response'
    print('    Password changed back to original password.')
run_test('User Change Password (POST /api/auth/change-password)', test_user_change_password)

log_section('FINAL VERIFICATION SUMMARY')
print(f'Total Tests Run: {passed_tests + failed_tests}')
print(f'Passed: {passed_tests}')
print(f'Failed: {failed_tests}')
if failed_tests > 0:
    sys.exit(1)
