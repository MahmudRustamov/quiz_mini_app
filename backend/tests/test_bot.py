from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.bot import main as bot_module
from app.core.config import get_settings


@pytest.mark.parametrize('url,ready', [
    ('http://localhost:5173', False),
    ('https://localhost:5173', False),
    ('https://127.0.0.1:5173', False),
    ('https://[::1]:5173', False),
    ('https://192.168.1.10', False),
    ('https://user:pass@example.com', False),
    ('https://example.com/app', True),
    ('https://example.trycloudflare.com', True),
    ('', False),
])
def test_mini_app_url_readiness(url, ready):
    assert bot_module.mini_app_ready(url) is ready


async def test_start_replies_with_local_url_without_invalid_webapp_button(monkeypatch):
    monkeypatch.setattr(get_settings(), 'mini_app_url', 'http://localhost:5173')
    monkeypatch.setattr(get_settings(), 'admin_telegram_ids', [123])
    message = SimpleNamespace(chat=SimpleNamespace(type='private'),
                              from_user=SimpleNamespace(id=123), answer=AsyncMock())
    await bot_module.start(message)
    message.answer.assert_awaited_once()
    args, kwargs = message.answer.await_args
    assert 'xush kelibsiz' in args[0]
    assert 'MINI_APP_URL' in args[0]
    assert 'reply_markup' not in kwargs


async def test_start_sends_https_mini_app_button(monkeypatch):
    monkeypatch.setattr(get_settings(), 'mini_app_url', 'https://example.com/app')
    message = SimpleNamespace(chat=SimpleNamespace(type='private'),
                              from_user=SimpleNamespace(id=123), answer=AsyncMock())
    await bot_module.start(message)
    keyboard = message.answer.await_args.kwargs['reply_markup']
    assert keyboard.inline_keyboard[0][0].web_app.url == 'https://example.com/app'


async def test_group_start_uses_private_chat_guidance(monkeypatch):
    monkeypatch.setattr(get_settings(), 'mini_app_url', 'https://example.com/app')
    message = SimpleNamespace(chat=SimpleNamespace(type='group'), answer=AsyncMock())
    await bot_module.start(message)
    assert 'shaxsiy chatida' in message.answer.await_args.args[0]
    assert 'reply_markup' not in message.answer.await_args.kwargs


async def test_bot_diagnostics_do_not_poll_or_send_messages(monkeypatch, capsys):
    monkeypatch.setattr(get_settings(), 'bot_token', '123:private-test-token')
    bot = SimpleNamespace(get_me=AsyncMock(return_value=SimpleNamespace(username='test_bot')),
        get_webhook_info=AsyncMock(return_value=SimpleNamespace(url='', pending_update_count=2)),
        session=SimpleNamespace(close=AsyncMock()))
    monkeypatch.setattr(bot_module, 'get_bot', lambda: bot)
    polling = AsyncMock()
    monkeypatch.setattr(bot_module.dispatcher, 'start_polling', polling)
    await bot_module.run_command('check')
    output = capsys.readouterr().out
    assert '@test_bot' in output
    assert 'private-test-token' not in output
    polling.assert_not_awaited()
    bot.session.close.assert_awaited_once()


async def test_poll_refuses_existing_webhook(monkeypatch):
    monkeypatch.setattr(get_settings(), 'bot_token', '123:private-test-token')
    monkeypatch.setattr(get_settings(), 'bot_mode', 'polling')
    bot = SimpleNamespace(get_me=AsyncMock(return_value=SimpleNamespace(username='test_bot')),
        get_webhook_info=AsyncMock(return_value=SimpleNamespace(url='https://example.com/webhook')),
        session=SimpleNamespace(close=AsyncMock()))
    monkeypatch.setattr(bot_module, 'get_bot', lambda: bot)
    polling = AsyncMock()
    monkeypatch.setattr(bot_module.dispatcher, 'start_polling', polling)
    with pytest.raises(RuntimeError, match='Webhook'):
        await bot_module.run_command('poll')
    polling.assert_not_awaited()
    bot.session.close.assert_awaited_once()


async def test_disabled_poll_explains_bot_helper(monkeypatch):
    monkeypatch.setattr(get_settings(), 'bot_token', '123:private-test-token')
    monkeypatch.setattr(get_settings(), 'bot_mode', 'disabled')
    with pytest.raises(RuntimeError, match='scripts/bot.sh'):
        await bot_module.run_command('poll')


def test_duplicate_local_polling_is_prevented(tmp_path, monkeypatch):
    # Keep the regression independent of the real bot running in this workspace.
    monkeypatch.setattr(bot_module, '__file__', str(tmp_path / 'backend/app/bot/main.py'))
    with bot_module.polling_lock():
        with pytest.raises(RuntimeError, match='boshqa terminalda'):
            with bot_module.polling_lock():
                pytest.fail('Second polling process acquired the lock')
