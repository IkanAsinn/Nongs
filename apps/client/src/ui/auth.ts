/**
 * Log in and register, shown on the loading page once everything has loaded.
 * The checks are the server's own (packages/shared/src/account.ts), so most
 * mistakes are caught before anything is sent.
 */
import { parseBirthday, passwordProblem, usernameProblem, type Account } from '@nongs/shared';
import { api, ApiError } from '../net/api';

type Mode = 'login' | 'register';

export class AuthPanel {
  private mode: Mode = 'login';
  private readonly form: HTMLFormElement;
  private readonly title: HTMLElement;
  private readonly birthdayRow: HTMLElement;
  private readonly username: HTMLInputElement;
  private readonly password: HTMLInputElement;
  private readonly birthday: HTMLInputElement;
  private readonly error: HTMLElement;
  private readonly submit: HTMLButtonElement;
  private readonly switchText: HTMLElement;
  private readonly switchButton: HTMLButtonElement;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <form id="auth-form" novalidate>
        <h2 id="auth-title"></h2>
        <label>Username
          <input name="username" autocomplete="username" maxlength="16" spellcheck="false" required />
        </label>
        <label>Password
          <input name="password" type="password" maxlength="128" required />
        </label>
        <label id="auth-birthday">Birthday
          <input name="birthday" placeholder="DD-MM-YYYY" inputmode="numeric" maxlength="10" autocomplete="bday" />
        </label>
        <p id="auth-error" role="alert"></p>
        <button id="auth-submit" type="submit"></button>
        <p id="auth-switch"><span></span> <button type="button"></button></p>
      </form>`;
    const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    this.form = $('#auth-form');
    this.title = $('#auth-title');
    this.birthdayRow = $('#auth-birthday');
    this.username = $('input[name=username]');
    this.password = $('input[name=password]');
    this.birthday = $('input[name=birthday]');
    this.error = $('#auth-error');
    this.submit = $('#auth-submit');
    this.switchText = $('#auth-switch span');
    this.switchButton = $('#auth-switch button');

    // Typing here must not walk the character around or press game keys.
    for (const type of ['keydown', 'keyup'] as const) root.addEventListener(type, (event) => event.stopPropagation());
    root.addEventListener('click', (event) => event.stopPropagation());
    // Dashes appear by themselves while the birthday is typed: 17112005 becomes 17-11-2005.
    this.birthday.addEventListener('input', () => {
      const digits = this.birthday.value.replace(/\D/g, '').slice(0, 8);
      this.birthday.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('-');
    });
    this.switchButton.addEventListener('click', () => this.show(this.mode === 'login' ? 'register' : 'login'));
    this.show('login');
  }

  /** Shows the form and resolves with the account once the player is in. */
  ask(): Promise<Account> {
    this.root.hidden = false;
    this.username.focus();
    return new Promise((resolve) => {
      this.form.onsubmit = (event) => {
        event.preventDefault();
        void this.send().then((account) => {
          if (!account) return;
          this.root.hidden = true;
          resolve(account);
        });
      };
    });
  }

  private show(mode: Mode): void {
    this.mode = mode;
    const register = mode === 'register';
    this.title.textContent = register ? 'Make an account' : 'Welcome to Nongs!';
    this.birthdayRow.hidden = !register;
    this.password.autocomplete = register ? 'new-password' : 'current-password';
    this.submit.textContent = register ? 'Register' : 'Log in';
    this.switchText.textContent = register ? 'Have an account?' : 'New here?';
    this.switchButton.textContent = register ? 'Log in' : 'Register';
    this.error.textContent = '';
  }

  private async send(): Promise<Account | null> {
    const username = this.username.value.trim();
    const password = this.password.value;
    const register = this.mode === 'register';
    const problem = register
      ? (usernameProblem(username) ??
        passwordProblem(password) ??
        (parseBirthday(this.birthday.value) ? null : 'Write your birthday as DD-MM-YYYY, for example 17-11-2005.'))
      : !username || !password
        ? 'Fill in your username and password.'
        : null;
    if (problem) {
      this.error.textContent = problem;
      return null;
    }
    this.error.textContent = '';
    this.submit.disabled = true;
    try {
      return register
        ? await api.register({ username, password, birthday: this.birthday.value })
        : await api.login({ username, password });
    } catch (error) {
      this.error.textContent = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
      return null;
    } finally {
      this.submit.disabled = false;
    }
  }
}
