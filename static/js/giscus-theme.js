// https://github.com/giscus/giscus/issues/336#issuecomment-1007922777
function changeGiscusTheme() {
    const theme = localStorage.getItem(THEME_PREF_STORAGE_KEY) ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    function sendMessage(message) {
        const iframe = document.querySelector('iframe.giscus-frame');
        if (!iframe) return;
        iframe.contentWindow.postMessage({ giscus: message }, 'https://giscus.app');
    }
    sendMessage({
        setConfig: {
            theme: theme,
        },
    });
}

document.addEventListener('DOMContentLoaded', function () {
    const darkThemeToggles = document.querySelectorAll('.dark-theme-toggle');
    darkThemeToggles.forEach(el => el.addEventListener('click', changeGiscusTheme))
});
