Feature: user
  In order to manipulate users
  As a user
  I need to create modifiy and delete user

 Scenario: create new user
 	As a user
 	I need to be able to create a new user
 	Given i have user with name "grupo de teste" 
 	When i call user_save 
 	Then  i call users 
 	And Then i should see that total number users is "1"

