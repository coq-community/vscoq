REM Download platform script

SET PATH=%PATH%;C:\Program Files\7-Zip;C:\Program Files\Git\mingw64\bin

SET PLATFORM=https://github.com/coq/platform/archive/coq-ci.zip

SET ARCH=64

ECHO   "Downloading %PLATFORM%"
curl   -L -o platform.zip "%PLATFORM%"
7z x platform.zip

REM Build the platform

SET CYGROOT=C:\ci\cygwin%ARCH%
SET CYGCACHE=C:\ci\cache\cygwin

SET CYGWIN_QUIET=y

SET COQREGTESTING=y

cd platform-*

call coq_platform_make_windows.bat ^
  -arch=%ARCH% ^
  -pick=dev ^
  -destcyg=%CYGROOT% ^
  -cygcache=%CYGCACHE% ^
  -extent=b ^
  -parallel=p ^
  -jobs=2 ^
  -switch=d ^
  -set-switch=y ^
  -override-dev-pkg="coq-core=https://github.com/coq/coq/archive/%COQ_VERSION%.tar.gz" ^
  -override-dev-pkg="coq-stdlib=https://github.com/coq/coq/archive/%COQ_VERSION%.tar.gz" ^
  -override-dev-pkg="coqide-server=https://github.com/coq/coq/archive/%COQ_VERSION%.tar.gz" ^
  -override-dev-pkg="coq=https://github.com/coq/coq/archive/%COQ_VERSION%.tar.gz" ^
  || GOTO ErrorExit

SET OPAMYES=yes
C:\ci\cygwin64\bin\bash.exe --login -c "opam pin add --ignore-constraints-on=coq-core,coq-stdlib vscoq-language-server $(cygpath -m '%GITHUB_WORKSPACE%\language-server') --with-doc --with-test -y" || GOTO ErrorExit


GOTO :EOF

:ErrorExit
  ECHO ERROR %0 failed
  EXIT /b 1

