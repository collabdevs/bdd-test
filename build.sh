#!/bin/bash

# Set color codes.
  Color_Off='\033[0m';
  Black='\033[0;30m';
  Red='\033[0;31m';
  Green='\033[0;32m';
  Yellow='\033[0;33m';
  Blue='\033[0;34m';
  Purple='\033[0;35m';
  Cyan='\033[0;36m';
  White='\033[0;37m';

# Begin setup stuff.
echo -e $Green"
This script will create a stub PHP project with Codeception tests, TravisCI
and/or CircleCI continuous integration in the directory provided."$Color_Off;
php -S localhost:8000 -t public &



# Build and run Codeception project tests.
# Building Codeception suite and running \"%s\" tests... aqui tem uma var
echo "
Building Codeception suite and running  tests...

";

./vendor/bin/codecept --steps run $PROJECT;
codeceptjs --steps run $PROJECT;

# Print confirmation.
echo -e $Green;
printf "Great, you're all set to use Codeception, TravisCI and/or CircleCI in
your new \"%s\" project! To re-run the Codeception test suite:

  cd %s && ./vendor/bin/codecept --steps run %s
" $PROJECT $PROJECT $PROJECT;
echo -e $Color_Off;
echo "Your  project looks like this ";

#echo -e $Cyan;
#pwd && ls -la;
echo -e $Color_Off;