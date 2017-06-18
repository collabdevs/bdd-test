Feature: group
  In order to manipulate groups
  As a user
  I need to create modifiy and delete group

 Scenario: create new group
 	As a user
 	I need to be able to create a new group
 	Given i have group with name "grupo de teste" 
 	When i call group_save 
 	Then  i call groups 
 	And Then i should see that total number groups is "1"
 	


 Scenario: create new group whit correct name
 	As a user
 	I need to be able to create a new group
 	Given i have group with name "grupo de teste" 
 	When i call group_save 
 	Then  i call group
 	And Then i should see that group name is "grupo de teste"
