import contextlib
import json
import sys


def send(message):
    sys.__stdout__.write(json.dumps(message, ensure_ascii=False, separators=(',', ':')) + '\n')
    sys.__stdout__.flush()


with contextlib.redirect_stdout(sys.stderr):
    import laya
    agent = laya.load('convaiinnovations/laya', subfolder='multilingual')

send({'type': 'ready'})
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        if request.get('type') == 'close':
            break
        result = agent.predict(request['state'], request['questions'])
        send({'id': request['id'], 'ok': True, 'result': result})
    except Exception as error:
        send({'id': request.get('id'), 'ok': False, 'error': f'{type(error).__name__}: {error}'})
