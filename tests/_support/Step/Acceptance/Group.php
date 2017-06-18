<?php
namespace Step\Acceptance;

class Group extends \AcceptanceTester{
	private $group;
	private $todos;

    public function __construct()
    {
        $I = $this;
        $this->group = new \App\Group; 
    }

    /**
     * @Given i have group with name :arg1
     */
     public function iHaveGroupWithName($arg1)
     {
     	$this->group->name = $arg1;
     }

    /**
     * @When i call group_save
     */
     public function iCallGroup_save()
     {
     	$this->group->save();
     }

    /**
     * @Then i call groups
     */
     public function iCallGroups()
     {
     	$this->todos =  \App\Group::all();
     }

    /**
     * @Then Then i should see that total number groups is :arg1
     */
     public function thenIShouldSeeThatTotalNumberGroupsIs($arg1)
     {

        if($this->todos->count() == $arg1){
            return true;
        }else{
            throw new \Error("Não esta retornando o numero certo de grupos", 1);
            
        }
     }


       /**
     * @Then i call group
     */
     public function iCallGroup()
     {
        return true;
     }

    /**
     * @Then Then i should see that group name is :arg1
     */
     public function thenIShouldSeeThatGroupNameIs($arg1)
     {
        if($this->group->name == $arg1){
            return true;
        }else{
            throw new \Error("Nome do grupo não é ".$arg1, 1);
            
        }
     }


}